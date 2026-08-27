"""
PCAP ingestion — tshark → flat CSV → Artifact Explorer.

Rather than building a parallel packet store, a capture is dissected once with
tshark into a packet-list CSV and registered as a normal artifact. Everything
the Artifact Explorer already does — column filters, RQL, group-by, pinning
rows to the timeline with the full record attached — then works on packets for
free, and the Wireshark-style detail view reads individual frames back from the
original capture on demand.
"""
from __future__ import annotations

import csv
import shutil
import subprocess
from datetime import UTC
from pathlib import Path

PCAP_EXTS = {".pcap", ".pcapng", ".cap"}

# Packet-list columns, mirroring Wireshark's default view plus the application
# fields most often pivoted on during an investigation.
# (tshark field, CSV header) — header names are what the analyst sees.
_FIELDS: list[tuple[str, str]] = [
    ("frame.number",                        "No"),
    # Epoch rather than frame.time_utc: tshark renders the latter as
    # "Jul 31, 2025 22:13:20 UTC", which sorts alphabetically by month name.
    # It is rewritten to ISO-8601 below. "Timestamp" matches the Artifact
    # Explorer's date-column heuristic, making packets sortable and pinnable.
    ("frame.time_epoch",                    "Timestamp"),
    ("_ws.col.Source",                      "Source"),
    ("_ws.col.Destination",                 "Destination"),
    ("_ws.col.Protocol",                    "Protocol"),
    ("frame.len",                           "Length"),
    ("_ws.col.Info",                        "Info"),
    ("tcp.srcport",                         "TcpSrcPort"),
    ("tcp.dstport",                         "TcpDstPort"),
    ("udp.srcport",                         "UdpSrcPort"),
    ("udp.dstport",                         "UdpDstPort"),
    ("tcp.flags.str",                       "TcpFlags"),
    ("tcp.stream",                          "TcpStream"),
    ("dns.qry.name",                        "DnsQuery"),
    ("dns.a",                               "DnsAnswer"),
    ("http.request.method",                 "HttpMethod"),
    ("http.host",                           "HttpHost"),
    ("http.request.uri",                    "HttpUri"),
    ("http.response.code",                  "HttpStatus"),
    ("http.user_agent",                     "HttpUserAgent"),
    ("tls.handshake.extensions_server_name", "TlsServerName"),
    ("eth.src",                             "SrcMac"),
    ("eth.dst",                             "DstMac"),
]

# Guard against a malformed or hostile capture wedging the worker
CONVERT_TIMEOUT = 1800   # 30 min
DETAIL_TIMEOUT  = 30


class TsharkUnavailable(RuntimeError):
    """Raised when tshark is not installed in the image."""


def tshark_path() -> str:
    path = shutil.which("tshark")
    if not path:
        raise TsharkUnavailable(
            "tshark introuvable — le parsing PCAP nécessite tshark dans l'image backend"
        )
    return path


def tshark_version() -> str | None:
    try:
        out = subprocess.run([tshark_path(), "--version"], capture_output=True,
                             text=True, timeout=10)
        return out.stdout.splitlines()[0].strip() if out.stdout else None
    except Exception:
        return None


def is_pcap(filename: str) -> bool:
    return Path(filename).suffix.lower() in PCAP_EXTS


def convert_to_csv(pcap_path: Path, out_csv: Path | None = None,
                   display_filter: str | None = None) -> Path:
    """
    Dissect a capture into a packet-list CSV next to the original.

    Returns the CSV path. Raises TsharkUnavailable if tshark is missing, or
    CalledProcessError / TimeoutExpired if the capture cannot be read.
    """
    binary = tshark_path()
    out_csv = out_csv or pcap_path.with_suffix(pcap_path.suffix + ".packets.csv")

    cmd = [binary, "-r", str(pcap_path), "-T", "fields",
           "-E", "header=y", "-E", "separator=,", "-E", "quote=d",
           # Multi-occurrence fields (several DNS answers in one packet, …)
           # collapse to a single cell rather than exploding the row.
           "-E", "occurrence=a", "-E", "aggregator=|"]
    if display_filter:
        cmd += ["-Y", display_filter]
    for field, _ in _FIELDS:
        cmd += ["-e", field]

    print(f"[pcap] dissecting {pcap_path.name} → {out_csv.name}", flush=True)
    with out_csv.open("w", encoding="utf-8", newline="") as fh:
        proc = subprocess.run(cmd, stdout=fh, stderr=subprocess.PIPE,
                              text=True, timeout=CONVERT_TIMEOUT)
    if proc.returncode != 0:
        err = (proc.stderr or "").strip()[:400]
        out_csv.unlink(missing_ok=True)
        raise RuntimeError(f"tshark a échoué sur {pcap_path.name}: {err}")

    rows = _postprocess(out_csv)
    print(f"[pcap] {pcap_path.name}: {rows} paquet(s)", flush=True)
    return out_csv


def _postprocess(csv_path: Path) -> int:
    """
    Rename columns to the friendly headers and turn epoch times into ISO-8601.

    tshark lowercases some `_ws.col.*` names and silently drops fields its build
    does not know, so columns are matched positionally rather than by name.
    Returns the number of data rows. Streamed via a sibling temp file so a huge
    capture is never held in memory.
    """
    from datetime import datetime

    headers = [h for _, h in _FIELDS]
    tmp = csv_path.with_suffix(csv_path.suffix + ".tmp")
    ts_idx = headers.index("Timestamp")
    data_rows = 0

    with csv_path.open("r", encoding="utf-8", newline="") as src, \
         tmp.open("w", encoding="utf-8", newline="") as dst:
        reader = csv.reader(src)
        writer = csv.writer(dst, quoting=csv.QUOTE_ALL)

        try:
            actual = next(reader)
        except StopIteration:
            # Empty capture — emit a header-only artifact rather than failing
            writer.writerow(headers)
            tmp.replace(csv_path)
            return 0

        aligned = len(actual) == len(headers)
        if not aligned:
            print(f"[pcap] {len(actual)} colonnes pour {len(headers)} attendues — "
                  f"en-tête tshark conservé, horodatage laissé en epoch", flush=True)
        writer.writerow(headers if aligned else actual)

        for row in reader:
            if aligned and len(row) == len(headers) and row[ts_idx]:
                try:
                    row[ts_idx] = datetime.fromtimestamp(
                        float(row[ts_idx]), tz=UTC
                    ).isoformat(timespec="microseconds").replace("+00:00", "Z")
                except (ValueError, OSError, OverflowError):
                    pass  # keep the raw value rather than dropping the packet
            writer.writerow(row)
            data_rows += 1

    tmp.replace(csv_path)
    return data_rows


def count_rows(csv_path: Path) -> int:
    """Data rows in a CSV, header excluded."""
    try:
        with csv_path.open("r", encoding="utf-8", errors="replace") as fh:
            return max(0, sum(1 for _ in fh) - 1)
    except OSError:
        return 0


FOLLOW_TIMEOUT = 120
# Ceiling on the payload returned for one conversation, so a bulk transfer
# cannot flood the API response or the browser.
FOLLOW_MAX_BYTES = 2 * 1024 * 1024


def follow_stream(pcap_path: Path, stream_index: int, protocol: str = "tcp") -> dict:
    """
    Reassemble one conversation, as Wireshark's "Follow TCP Stream" does.

    Uses tshark's `raw` mode rather than `ascii`: it hex-encodes each chunk, so
    binary payloads survive intact (an `ascii` follow rewrites non-printable
    bytes to dots and the original content is lost).

    Output being parsed:

        ===================================================================
        Follow: tcp,raw
        Filter: tcp.stream eq 0
        Node 0: 192.168.1.10:44322
        Node 1: 93.184.216.34:80
        4745540...                 <- client → server
        \t485454502...             <- server → client (leading tab)
        ===================================================================
    """
    if protocol not in ("tcp", "udp"):
        raise ValueError("protocol doit être 'tcp' ou 'udp'")

    binary = tshark_path()
    cmd = [binary, "-r", str(pcap_path), "-q",
           "-z", f"follow,{protocol},raw,{int(stream_index)}"]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=FOLLOW_TIMEOUT)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or "").strip()[:400])

    node0 = node1 = ""
    chunks: list[dict] = []
    total = 0
    truncated = False

    for line in (proc.stdout or "").splitlines():
        if line.startswith("Node 0:"):
            node0 = line.split(":", 1)[1].strip()
            continue
        if line.startswith("Node 1:"):
            node1 = line.split(":", 1)[1].strip()
            continue
        # Skip banner, filter line and separators
        if not line or line.startswith(("=", "Follow:", "Filter:")):
            continue

        # A leading tab marks the second node's direction
        is_s2c = line.startswith("\t")
        payload = line.strip()
        if not payload or any(c not in "0123456789abcdefABCDEF" for c in payload):
            continue

        size = len(payload) // 2
        if total + size > FOLLOW_MAX_BYTES:
            truncated = True
            break
        total += size
        chunks.append({
            "direction": "s2c" if is_s2c else "c2s",
            "hex":       payload,
            "bytes":     size,
        })

    return {
        "protocol":     protocol,
        "stream":       int(stream_index),
        "node0":        node0,
        "node1":        node1,
        "chunks":       chunks,
        "total_bytes":  total,
        "truncated":    truncated,
    }


def frame_detail(pcap_path: Path, frame_number: int) -> dict:
    """
    Full protocol tree for one packet, as tshark's JSON dissection.

    Backs the Wireshark-style detail pane: the packet list comes from the CSV,
    and only the selected frame is dissected again here.
    """
    import json

    binary = tshark_path()
    cmd = [binary, "-r", str(pcap_path), "-T", "json",
           "-Y", f"frame.number=={int(frame_number)}", "-x"]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=DETAIL_TIMEOUT)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or "").strip()[:400])

    try:
        parsed = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError:
        return {}
    return parsed[0] if parsed else {}
