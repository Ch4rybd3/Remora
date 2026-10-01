"""
Who talked to whom in a capture, and how much.

The packet list answers "what was on the wire" and the Explorer filters it well.
It cannot answer "what is the shape of this network": four hundred thousand rows
of source, destination and protocol hold a dozen machines and forty
conversations, and reading them off a table one page at a time is how an
afternoon disappears.

So this folds the same rows into hosts and the conversations between them. It
reads through the artifact store, like the process tree does, rather than running
tshark again - the capture was dissected once at ingest and re-dissecting it to
answer a different question would be the same work twice, with a second chance
to disagree.

**A host is its IP address.** Not its MAC, which changes at every router hop and
is absent from a capture taken off a span port; not its hostname, which may never
appear. MAC, DNS names and TLS server names are *attached* to the address as
what the capture happens to know about it - several of each, where the capture
saw several, because asserting one would be inventing certainty the packets do
not carry.

**Nothing here writes to the case.** A capture of a busy subnet contains hundreds
of addresses with no bearing on the investigation, and turning them into assets
automatically would bury the ones that matter. Where an address matches an asset
the case already has, that is reported alongside the host so the analyst can see
it; adopting it in either direction is an action they take.
"""
from __future__ import annotations

import ipaddress
from collections import defaultdict
from dataclasses import dataclass, field

# ── Columns of the packet-list CSV, from services/pcap.py ─────────────────────

SOURCE      = "Source"
DESTINATION = "Destination"
PROTOCOL    = "Protocol"
LENGTH      = "Length"
SRC_MAC     = "SrcMac"
DNS_QUERY   = "DnsQuery"
DNS_ANSWER  = "DnsAnswer"
TLS_SNI     = "TlsServerName"
HTTP_HOST   = "HttpHost"
TCP_PORT    = "TcpDstPort"
UDP_PORT    = "UdpDstPort"

#: A map is a picture. Past these it stops being one, so the busiest are kept
#: and the rest are counted - a scan of a /24 is a finding, not forty icons.
MAX_HOSTS         = 120
MAX_CONVERSATIONS = 300
#: Per host, in the detail panel. Enough to recognise a machine, not a port scan.
MAX_NAMES = 6
MAX_MACS  = 4
MAX_PORTS = 12

#: Suggested icons. The vocabulary is `AssetType`, so a host adopted as an asset
#: keeps the same word for the same thing.
KIND_WORKSTATION = "workstation"
KIND_SERVER      = "server"
KIND_INTERNET    = "cloud_resource"
KIND_UNKNOWN     = "other"


@dataclass(frozen=True)
class Conversation:
    """One pair of addresses, both directions folded together."""
    a:         str
    b:         str
    packets:   int
    bytes:     float
    #: Per direction, because "who initiated" is usually the question and a
    #: folded total cannot answer it.
    a_to_b:    int
    b_to_a:    int
    protocols: list[str]


@dataclass
class Host:
    address:   str
    packets:   int = 0
    bytes:     float = 0.0
    sent:      int = 0
    received:  int = 0
    peers:     int = 0
    macs:      list[str] = field(default_factory=list)
    #: DNS answers, TLS server names and HTTP hosts seen for this address.
    names:     list[str] = field(default_factory=list)
    #: Destination ports this address was contacted on.
    ports:     list[int] = field(default_factory=list)
    private:   bool = False
    #: What the icon starts as. Always overridden by what the analyst saved.
    suggested_kind: str = KIND_UNKNOWN


@dataclass(frozen=True)
class ConversationMap:
    hosts:                 list[Host]
    conversations:         list[Conversation]
    total_packets:         int
    omitted_hosts:         int
    omitted_conversations: int


# ── Addresses ─────────────────────────────────────────────────────────────────

def is_address(value: str) -> bool:
    """
    Whether a Source or Destination cell is an IP address at all.

    tshark's `_ws.col.Source` falls back to a MAC for a frame with no network
    layer - ARP, STP, LLDP - and those are not hosts on a conversation map.
    """
    try:
        ipaddress.ip_address(value.strip())
        return True
    except ValueError:
        return False


def is_private(address: str) -> bool:
    """Private, loopback or link-local: somewhere on the network being examined."""
    try:
        parsed = ipaddress.ip_address(address.strip())
    except ValueError:
        return False
    return bool(parsed.is_private or parsed.is_loopback or parsed.is_link_local)


def suggest_kind(host: Host, served_peers: int) -> str:
    """
    A starting icon, deliberately timid.

    Setting forty icons by hand is the reason a map gets abandoned, so the
    obvious cases are offered: anything outside the local ranges is somewhere on
    the internet, and a local address several machines connected *to* is serving
    something. Everything else stays unknown rather than guessing, because a
    wrong icon is worse than no icon - it is read as a finding.
    """
    if not host.private:
        return KIND_INTERNET
    if served_peers >= 2 and host.ports:
        return KIND_SERVER
    if host.received == 0 and host.sent > 0:
        return KIND_WORKSTATION
    return KIND_UNKNOWN


# ── Building ──────────────────────────────────────────────────────────────────

def _cell(group, column: str) -> str:
    return str(group.values.get(column) or "").strip()


def _top(counts: dict[str, int], limit: int) -> list[str]:
    return [value for value, _ in
            sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))[:limit]]


def build_map(store, source, columns: list[str]) -> ConversationMap:
    """
    Fold a packet-list artifact into hosts and conversations.

    `store` is an `ArtifactStore` and `source` whatever it reads; passed in
    rather than looked up so this can be tested against a fake that returns
    groups, with no file and no DuckDB.
    """
    available = set(columns)
    if SOURCE not in available or DESTINATION not in available:
        return ConversationMap([], [], 0, 0, 0)

    from .store import Query

    def aggregate(group_by: list[str], sums: list[str] | None = None):
        wanted = [c for c in group_by if c in available]
        if len(wanted) != len(group_by):
            return []
        return store.aggregate(source, columns, Query(), wanted,
                               [c for c in (sums or []) if c in available])

    # ── Conversations ────────────────────────────────────────────────────────
    pairs: dict[tuple[str, str], dict] = {}
    hosts: dict[str, Host] = {}
    peers: dict[str, set[str]] = defaultdict(set)
    total_packets = 0

    for group in aggregate([SOURCE, DESTINATION, PROTOCOL], [LENGTH]):
        src, dst = _cell(group, SOURCE), _cell(group, DESTINATION)
        if not is_address(src) or not is_address(dst) or src == dst:
            continue
        packets = group.count
        volume  = group.sums.get(LENGTH, 0.0)
        total_packets += packets

        key = (src, dst) if src <= dst else (dst, src)
        entry = pairs.setdefault(key, {
            "packets": 0, "bytes": 0.0, "a_to_b": 0, "b_to_a": 0, "protocols": {},
        })
        entry["packets"] += packets
        entry["bytes"]   += volume
        if (src, dst) == key:
            entry["a_to_b"] += packets
        else:
            entry["b_to_a"] += packets
        protocol = _cell(group, PROTOCOL)
        if protocol:
            entry["protocols"][protocol] = entry["protocols"].get(protocol, 0) + packets

        for address, sent in ((src, True), (dst, False)):
            host = hosts.setdefault(address, Host(address=address,
                                                  private=is_private(address)))
            host.packets += packets
            host.bytes   += volume
            if sent:
                host.sent += packets
            else:
                host.received += packets
        peers[src].add(dst)
        peers[dst].add(src)

    if not hosts:
        return ConversationMap([], [], 0, 0, 0)

    # ── What the capture knows about each address ────────────────────────────
    macs:  dict[str, dict[str, int]] = defaultdict(dict)
    names: dict[str, dict[str, int]] = defaultdict(dict)
    ports: dict[str, dict[str, int]] = defaultdict(dict)
    # How many distinct peers reached a host on a port it was listening on.
    served: dict[str, set[str]] = defaultdict(set)

    for group in aggregate([SOURCE, SRC_MAC]):
        address, mac = _cell(group, SOURCE), _cell(group, SRC_MAC)
        if mac and address in hosts:
            macs[address][mac] = macs[address].get(mac, 0) + group.count

    # A DNS answer is the strongest name a capture carries: the network itself
    # said this address is that name.
    for group in aggregate([DNS_ANSWER, DNS_QUERY]):
        address, name = _cell(group, DNS_ANSWER), _cell(group, DNS_QUERY)
        if name and address in hosts:
            names[address][name] = names[address].get(name, 0) + group.count

    for column in (TLS_SNI, HTTP_HOST):
        for group in aggregate([DESTINATION, column]):
            address, name = _cell(group, DESTINATION), _cell(group, column)
            if name and address in hosts:
                names[address][name] = names[address].get(name, 0) + group.count

    for column in (TCP_PORT, UDP_PORT):
        for group in aggregate([DESTINATION, SOURCE, column]):
            address = _cell(group, DESTINATION)
            port    = _cell(group, column)
            if not port or address not in hosts:
                continue
            ports[address][port] = ports[address].get(port, 0) + group.count
            served[address].add(_cell(group, SOURCE))

    for address, host in hosts.items():
        host.peers = len(peers[address])
        host.macs  = _top(macs[address], MAX_MACS)
        host.names = _top(names[address], MAX_NAMES)
        host.ports = sorted(
            {int(p) for p in _top(ports[address], MAX_PORTS) if p.isdigit()})
        host.suggested_kind = suggest_kind(host, len(served[address]))

    # ── Keep it a picture ────────────────────────────────────────────────────
    ranked_hosts = sorted(hosts.values(), key=lambda h: (-h.packets, h.address))
    kept_hosts   = ranked_hosts[:MAX_HOSTS]
    kept         = {host.address for host in kept_hosts}

    conversations = [
        Conversation(
            a=a, b=b,
            packets=entry["packets"], bytes=entry["bytes"],
            a_to_b=entry["a_to_b"], b_to_a=entry["b_to_a"],
            protocols=_top(entry["protocols"], MAX_NAMES),
        )
        for (a, b), entry in pairs.items() if a in kept and b in kept
    ]
    conversations.sort(key=lambda c: (-c.packets, c.a, c.b))

    return ConversationMap(
        hosts                 = kept_hosts,
        conversations         = conversations[:MAX_CONVERSATIONS],
        total_packets         = total_packets,
        omitted_hosts         = len(ranked_hosts) - len(kept_hosts),
        omitted_conversations = max(len(conversations) - MAX_CONVERSATIONS, 0),
    )
