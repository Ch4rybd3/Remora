"""
PCAP router — /api/v1/cases/{case_id}/artifacts/{artifact_id}/pcap/...

A capture is browsed as a normal artifact (the packet-list CSV produced by
services/pcap.py), so listing, filtering and timeline pinning all come from the
Artifact Explorer. This router adds what a CSV cannot express: the Wireshark
protocol tree and raw bytes of a single frame, dissected on demand from the
original capture.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..database import get_db
from ..models.asset import Asset, AssetType
from ..models.csv_artifact import CsvArtifactFile
from ..models.pcap_host import PcapHost
from ..services import pcap as pcap_service
from ..services import pcap_map
from ..services.audit_service import audit_log
from ..services.store import Source, SourceMissing, get_store

router = APIRouter(tags=["pcap"])

# Suffix appended by services/pcap.convert_to_csv
_CSV_SUFFIX = ".packets.csv"


def _resolve_capture(artifact_id: str, case_id: str, db: Session) -> Path:
    """
    Map a packet-list artifact back to the capture it was dissected from.

    The CSV lives beside the original as `<capture>.packets.csv`, so no extra
    table is needed to remember the association.
    """
    artifact = db.query(CsvArtifactFile).filter(
        CsvArtifactFile.id == artifact_id,
        CsvArtifactFile.case_id == case_id,
    ).first()
    if not artifact:
        raise HTTPException(404, "Artifact not found")

    csv_path = Path(artifact.file_path)
    if not csv_path.name.endswith(_CSV_SUFFIX):
        raise HTTPException(400, "This artifact is not a network capture")

    capture = csv_path.with_name(csv_path.name[: -len(_CSV_SUFFIX)])
    if not capture.exists():
        raise HTTPException(
            410,
            "The original capture is no longer available - only the packet list "
            "remains (the file may have been purged after 90 days)",
        )
    return capture


@router.get("/pcap/status")
def pcap_status(current_user=Depends(get_current_user)):
    """Whether the backend can dissect captures, for UI capability checks."""
    version = pcap_service.tshark_version()
    return {
        "available":       version is not None,
        "tshark_version":  version,
        "supported_exts":  sorted(pcap_service.PCAP_EXTS),
    }


@router.get("/cases/{case_id}/artifacts/{artifact_id}/pcap/streams/{stream_index}")
def get_stream(
    case_id: str,
    artifact_id: str,
    stream_index: int,
    protocol: str = "tcp",
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Reassembled conversation — Wireshark's "Follow TCP Stream"."""
    if stream_index < 0:
        raise HTTPException(400, "stream_index must be >= 0")
    if protocol not in ("tcp", "udp"):
        raise HTTPException(400, "protocol must be 'tcp' or 'udp'")

    capture = _resolve_capture(artifact_id, case_id, db)
    try:
        result = pcap_service.follow_stream(capture, stream_index, protocol)
    except pcap_service.TsharkUnavailable as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(500, f"Reassembly failed: {e}")

    if not result["chunks"]:
        raise HTTPException(
            404,
            f"{protocol} stream #{stream_index} is empty or not found "
            f"(a handshake with no payload has nothing to reassemble)",
        )
    return {**result, "capture": capture.name}


@router.get("/cases/{case_id}/artifacts/{artifact_id}/pcap/frames/{frame_number}")
def get_frame(
    case_id: str,
    artifact_id: str,
    frame_number: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Full protocol tree and raw bytes for one packet — the detail pane."""
    if frame_number < 1:
        raise HTTPException(400, "frame_number must be >= 1")

    capture = _resolve_capture(artifact_id, case_id, db)
    try:
        detail = pcap_service.frame_detail(capture, frame_number)
    except pcap_service.TsharkUnavailable as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(500, f"Dissection failed: {e}")

    if not detail:
        raise HTTPException(404, f"Packet #{frame_number} not found in the capture")

    layers = detail.get("_source", {}).get("layers", {})
    return {
        "frame_number": frame_number,
        "capture":      capture.name,
        # Protocol names in dissection order, minus the `*_raw` byte blobs
        "protocols":    [k for k in layers if not k.endswith("_raw")],
        "layers":       layers,
    }


# ── Conversation map ──────────────────────────────────────────────────────────

class HostAnnotation(BaseModel):
    """What the analyst decided about one host. Every field optional."""
    label: str | None = None
    #: An `AssetType` value, or "" to go back to what the map suggests.
    kind:  str | None = None
    x:     float | None = None
    y:     float | None = None


class AdoptAsset(BaseModel):
    """Push a host into the case's assets. Deliberately an explicit action."""
    name:        str | None = None
    compromised: bool = False


def _packet_artifact(artifact_id: str, case_id: str, db: Session) -> CsvArtifactFile:
    artifact = db.query(CsvArtifactFile).filter(
        CsvArtifactFile.id == artifact_id,
        CsvArtifactFile.case_id == case_id,
    ).first()
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    if not str(artifact.file_path).endswith(_CSV_SUFFIX):
        raise HTTPException(400, "This artifact is not a network capture")
    return artifact


def _annotations(case_id: str, db: Session) -> dict[str, PcapHost]:
    rows = db.query(PcapHost).filter(PcapHost.case_id == case_id).all()
    return {str(row.address): row for row in rows}


def _assets_by_ip(case_id: str, db: Session) -> dict[str, Asset]:
    """
    The case's own assets, by IP, so the map can say one exists.

    Read only. A capture of a busy subnet holds hundreds of addresses with no
    bearing on the investigation, and creating assets from them would bury the
    ones that matter - so the map reports the match and the analyst decides.
    """
    found: dict[str, Asset] = {}
    for asset in db.query(Asset).filter(Asset.case_id == case_id).all():
        ip = str(asset.ip_address or "").strip()
        if ip and ip not in found:
            found[ip] = asset
    return found


@router.get("/cases/{case_id}/artifacts/{artifact_id}/pcap/map")
def conversation_map(
    case_id:     str,
    artifact_id: str,
    db:          Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Who talked to whom in this capture, and how much.

    Computed from the packet list every time rather than stored: the capture is
    the truth and a cached map is a second one that can disagree with it. What
    *is* stored is the analyst's half - labels, icons and positions - merged in
    here.
    """
    artifact = _packet_artifact(artifact_id, case_id, db)
    columns  = json.loads(str(artifact.columns) or "[]")
    source   = Source(
        ref         = str(artifact.file_path),
        date_column = str(artifact.date_column) if artifact.date_column else None,
        timezone    = str(artifact.source_timezone) if artifact.source_timezone else None,
    )

    try:
        built = pcap_map.build_map(get_store(), source, columns)
    except SourceMissing as missing:
        raise HTTPException(410, "The packet list is no longer on disk") from missing

    saved  = _annotations(case_id, db)
    assets = _assets_by_ip(case_id, db)

    hosts = []
    for host in built.hosts:
        note  = saved.get(host.address)
        asset = assets.get(host.address)
        hosts.append({
            "address":   host.address,
            "packets":   host.packets,
            "bytes":     int(host.bytes),
            "sent":      host.sent,
            "received":  host.received,
            "peers":     host.peers,
            "macs":      host.macs,
            "names":     host.names,
            "ports":     host.ports,
            "private":   host.private,
            # The suggestion and the decision are reported separately: the
            # interface has to be able to say "Remora guessed this" so the
            # analyst knows what they are looking at.
            "suggested_kind": host.suggested_kind,
            "label":     str(note.label or "") if note else "",
            "kind":      str(note.kind or "") if note else "",
            "x":         note.x if note else None,
            "y":         note.y if note else None,
            "asset":     {
                "id":          str(asset.id),
                "name":        str(asset.name),
                "type":        asset.type.value if asset.type else "other",
                "compromised": bool(asset.compromised),
                "linked":      bool(note and str(note.asset_id or "") == str(asset.id)),
            } if asset else None,
        })

    return {
        "hosts": hosts,
        "conversations": [
            {
                "a": c.a, "b": c.b,
                "packets": c.packets, "bytes": int(c.bytes),
                "a_to_b": c.a_to_b, "b_to_a": c.b_to_a,
                "protocols": c.protocols,
            }
            for c in built.conversations
        ],
        "total_packets":         built.total_packets,
        "omitted_hosts":         built.omitted_hosts,
        "omitted_conversations": built.omitted_conversations,
    }


@router.put("/cases/{case_id}/pcap/map/hosts/{address}")
def annotate_host(
    case_id:  str,
    address:  str,
    payload:  HostAnnotation,
    db:       Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Name a host, give it an icon, or put it where it belongs on the canvas.

    Saved against the case rather than the capture: an analyst who names
    10.0.0.5 while reading the first capture has named it for every capture in
    the investigation.
    """
    if not pcap_map.is_address(address):
        raise HTTPException(400, "Not an IP address")
    if payload.kind:
        try:
            AssetType(payload.kind)
        except ValueError as bad:
            raise HTTPException(400, f"Unknown host kind '{payload.kind}'") from bad

    row = db.query(PcapHost).filter(
        PcapHost.case_id == case_id, PcapHost.address == address).first()
    if row is None:
        row = PcapHost(case_id=case_id, address=address)
        db.add(row)

    judgement: dict[str, object] = {}
    for field_name in ("label", "kind", "x", "y"):
        value = getattr(payload, field_name)
        if value is None:
            continue
        if field_name in ("label", "kind") and str(value) != str(getattr(row, field_name) or ""):
            judgement[field_name] = value
        setattr(row, field_name, value)

    # Naming a host is a judgement about the incident and belongs in the trail.
    # Dragging it across the canvas is not, and auditing every drag would bury
    # the entries that matter under a hundred coordinates.
    if judgement:
        audit_log(db, user=current_user, action="pcap_map.annotate",
                  resource_type="pcap_host", resource_id=address,
                  resource_name=str(row.label or address), case_id=case_id,
                  details=judgement)
    db.commit()
    db.refresh(row)

    return {"address": address, "label": row.label, "kind": row.kind,
            "x": row.x, "y": row.y}


@router.post("/cases/{case_id}/pcap/map/hosts/{address}/asset", status_code=201)
def adopt_host_as_asset(
    case_id:  str,
    address:  str,
    payload:  AdoptAsset,
    db:       Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Turn a host on the map into an asset of the case.

    **Never automatic.** A capture holds every address that happened to be on
    the wire, and most of them have nothing to do with the investigation. The
    map shows them so the analyst can read the network; an asset is a claim
    that this machine is part of the incident, and only a person makes it.

    Idempotent against an asset the case already has for this address: it links
    the two rather than creating a second record of the same machine.
    """
    if not pcap_map.is_address(address):
        raise HTTPException(400, "Not an IP address")

    row = db.query(PcapHost).filter(
        PcapHost.case_id == case_id, PcapHost.address == address).first()
    existing = _assets_by_ip(case_id, db).get(address)

    if existing is None:
        kind = str(row.kind or "") if row else ""
        try:
            asset_type = AssetType(kind) if kind else AssetType.other
        except ValueError:
            asset_type = AssetType.other
        existing = Asset(
            case_id     = case_id,
            name        = (payload.name or (str(row.label) if row and row.label else "")
                           or address),
            type        = asset_type,
            ip_address  = address,
            compromised = payload.compromised,
        )
        db.add(existing)
        db.flush()

    if row is None:
        row = PcapHost(case_id=case_id, address=address)
        db.add(row)
    row.asset_id = existing.id

    audit_log(db, user=current_user, action="pcap_map.adopt_asset",
              resource_type="asset", resource_id=str(existing.id),
              resource_name=str(existing.name), case_id=case_id,
              details={"address": address})
    db.commit()
    db.refresh(existing)

    return {"id": str(existing.id), "name": str(existing.name),
            "type": existing.type.value if existing.type else "other",
            "ip_address": str(existing.ip_address or "")}
