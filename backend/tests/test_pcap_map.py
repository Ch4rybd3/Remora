"""
Who talked to whom in a capture.

The packet list answers "what was on the wire" and the Explorer filters it well.
It cannot answer "what is the shape of this network": four hundred thousand rows
hold a dozen machines and forty conversations, and reading that off a table one
page at a time is how an afternoon disappears.

These tests are about the fold - hosts, conversations, and what the capture knows
about an address - against a fake store, so there is no file and no DuckDB in the
way. The two rules with consequences outside the picture are pinned here too:
that a host is its IP address, and that nothing on the map writes to the case
unless the analyst says so.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pytest
from fastapi.testclient import TestClient

from app.services import pcap_map
from app.services.store.base import Group


@dataclass
class FakeStore:
    """
    An `ArtifactStore` that answers from a packet list given as dicts.

    Written out rather than mocked: the fold asks six different group-bys and a
    mock that returns one canned answer would pass while the real query returned
    nothing.
    """
    rows: list[dict] = field(default_factory=list)

    def aggregate(self, source, columns, query, group_by, sums=None):
        buckets: dict[tuple, dict] = {}
        for row in self.rows:
            key = tuple(str(row.get(column, "") or "") for column in group_by)
            bucket = buckets.setdefault(key, {"count": 0, "sums": {}})
            bucket["count"] += 1
            for column in sums or []:
                try:
                    value = float(row.get(column) or 0)
                except (TypeError, ValueError):
                    value = 0.0
                bucket["sums"][column] = bucket["sums"].get(column, 0.0) + value
        return [
            Group(values=dict(zip(group_by, key, strict=True)),
                  count=bucket["count"], sums=bucket["sums"])
            for key, bucket in buckets.items()
        ]


COLUMNS = ["Source", "Destination", "Protocol", "Length", "SrcMac",
           "DnsQuery", "DnsAnswer", "TlsServerName", "HttpHost",
           "TcpDstPort", "UdpDstPort"]


def packet(src, dst, protocol="TCP", length=100, **extra) -> dict:
    return {"Source": src, "Destination": dst, "Protocol": protocol,
            "Length": length, **extra}


def build(rows: list[dict]) -> pcap_map.ConversationMap:
    return pcap_map.build_map(FakeStore(rows), "ignored", COLUMNS)


def host_for(result, address):
    return next(host for host in result.hosts if host.address == address)


# ─── Addresses ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("value,expected", [
    ("10.0.0.5",      True),
    ("2001:db8::1",   True),
    ("  10.0.0.5  ",  True),
    ("aa:bb:cc:dd:ee:ff", False),   # tshark falls back to a MAC for ARP, STP
    ("Broadcast",     False),
    ("",              False),
])
def test_only_an_ip_address_is_a_host(value, expected):
    """
    A conversation map is between machines on a network. A frame with no network
    layer has no host to put on it, and drawing its MAC as one invents a machine.
    """
    assert pcap_map.is_address(value) is expected


@pytest.mark.parametrize("address,expected", [
    ("10.0.0.5",        True),
    ("192.168.1.1",     True),
    ("172.16.4.9",      True),
    ("127.0.0.1",       True),
    ("169.254.10.2",    True),
    ("8.8.8.8",         False),
    ("185.199.108.153", False),
])
def test_local_addresses_are_recognised(address, expected):
    assert pcap_map.is_private(address) is expected


def test_a_frame_with_no_network_layer_is_left_out():
    result = build([
        packet("10.0.0.1", "10.0.0.2"),
        packet("aa:bb:cc:dd:ee:ff", "Broadcast", protocol="ARP"),
    ])

    assert {host.address for host in result.hosts} == {"10.0.0.1", "10.0.0.2"}


def test_a_host_talking_to_itself_is_not_a_conversation():
    assert build([packet("10.0.0.1", "10.0.0.1")]).conversations == []


# ─── Conversations ────────────────────────────────────────────────────────────

def test_both_directions_are_one_conversation():
    """
    Two rows in a conversation table for the same pair is the thing that makes
    a packet list unreadable - and on a map it would be two lines between the
    same two icons.
    """
    result = build([
        packet("10.0.0.1", "10.0.0.2"),
        packet("10.0.0.2", "10.0.0.1"),
    ])

    assert len(result.conversations) == 1
    assert result.conversations[0].packets == 2


def test_each_direction_is_still_counted():
    """Folded for the picture, kept for the question - who initiated."""
    result = build([
        packet("10.0.0.1", "10.0.0.2"),
        packet("10.0.0.1", "10.0.0.2"),
        packet("10.0.0.2", "10.0.0.1"),
    ])
    conversation = result.conversations[0]

    assert (conversation.a, conversation.b) == ("10.0.0.1", "10.0.0.2")
    assert (conversation.a_to_b, conversation.b_to_a) == (2, 1)


def test_the_pair_is_ordered_the_same_way_whoever_spoke_first():
    forward = build([packet("10.0.0.1", "10.0.0.2")]).conversations[0]
    reverse = build([packet("10.0.0.2", "10.0.0.1")]).conversations[0]

    assert (forward.a, forward.b) == (reverse.a, reverse.b)


def test_volume_is_summed_not_counted():
    """
    Counting rows answers "how many packets" and cannot answer "how many bytes",
    and a conversation with four large transfers is not the same finding as one
    with four keepalives.
    """
    result = build([
        packet("10.0.0.1", "10.0.0.2", length=1400),
        packet("10.0.0.1", "10.0.0.2", length=600),
    ])

    assert result.conversations[0].bytes == 2000


def test_a_conversation_names_the_protocols_it_carried():
    result = build([
        packet("10.0.0.1", "10.0.0.2", protocol="TLSv1.3"),
        packet("10.0.0.1", "10.0.0.2", protocol="TLSv1.3"),
        packet("10.0.0.1", "10.0.0.2", protocol="TCP"),
    ])

    assert result.conversations[0].protocols[0] == "TLSv1.3"


def test_conversations_come_back_busiest_first():
    result = build(
        [packet("10.0.0.1", "10.0.0.9")] * 5 + [packet("10.0.0.1", "10.0.0.2")])

    assert result.conversations[0].b == "10.0.0.9"


# ─── What the capture knows about a host ──────────────────────────────────────

def test_a_hosts_traffic_is_split_into_sent_and_received():
    result = build([
        packet("10.0.0.1", "10.0.0.2"),
        packet("10.0.0.1", "10.0.0.2"),
        packet("10.0.0.2", "10.0.0.1"),
    ])

    assert (host_for(result, "10.0.0.1").sent,
            host_for(result, "10.0.0.1").received) == (2, 1)


def test_a_host_counts_its_distinct_peers():
    result = build([
        packet("10.0.0.1", "10.0.0.2"),
        packet("10.0.0.1", "10.0.0.3"),
        packet("10.0.0.1", "10.0.0.3"),
    ])

    assert host_for(result, "10.0.0.1").peers == 2


def test_a_dns_answer_names_the_address_it_resolved_to():
    """The strongest name a capture carries - the network itself said so."""
    result = build([
        packet("10.0.0.1", "8.8.8.8", protocol="DNS",
               DnsQuery="updates.acme.test", DnsAnswer="93.184.216.34"),
        packet("10.0.0.1", "93.184.216.34"),
    ])

    assert "updates.acme.test" in host_for(result, "93.184.216.34").names


def test_a_tls_server_name_is_attached_to_the_server():
    result = build([
        packet("10.0.0.1", "185.199.108.153", TlsServerName="cdn.evil.test"),
    ])

    assert "cdn.evil.test" in host_for(result, "185.199.108.153").names


def test_several_names_are_kept_rather_than_one_chosen():
    """
    One address serving three virtual hosts is a fact about the address.
    Picking one would assert a certainty the packets do not carry.
    """
    result = build([
        packet("10.0.0.1", "93.184.216.34", HttpHost="a.test"),
        packet("10.0.0.1", "93.184.216.34", HttpHost="b.test"),
    ])

    assert set(host_for(result, "93.184.216.34").names) == {"a.test", "b.test"}


def test_a_mac_is_attached_to_the_address_not_used_as_identity():
    """
    A MAC changes at every router hop and is absent from a span-port capture.
    It belongs beside the address, never instead of it.
    """
    result = build([packet("10.0.0.1", "10.0.0.2", SrcMac="aa:bb:cc:00:11:22")])
    host = host_for(result, "10.0.0.1")

    assert host.address == "10.0.0.1"
    assert host.macs == ["aa:bb:cc:00:11:22"]


def test_the_ports_a_host_was_contacted_on_are_listed():
    result = build([
        packet("10.0.0.1", "10.0.0.5", TcpDstPort="445"),
        packet("10.0.0.2", "10.0.0.5", TcpDstPort="3389"),
    ])

    assert host_for(result, "10.0.0.5").ports == [445, 3389]


# ─── A starting icon, timidly ─────────────────────────────────────────────────

def test_an_address_outside_the_local_ranges_is_suggested_as_remote():
    result = build([packet("10.0.0.1", "185.199.108.153")])

    assert host_for(result, "185.199.108.153").suggested_kind == pcap_map.KIND_INTERNET


def test_a_local_address_several_machines_connect_to_is_suggested_as_a_server():
    result = build([
        packet("10.0.0.1", "10.0.0.5", TcpDstPort="445"),
        packet("10.0.0.2", "10.0.0.5", TcpDstPort="445"),
    ])

    assert host_for(result, "10.0.0.5").suggested_kind == pcap_map.KIND_SERVER


def test_one_peer_is_not_enough_to_call_something_a_server():
    """A wrong icon is worse than no icon: it gets read as a finding."""
    result = build([packet("10.0.0.1", "10.0.0.5", TcpDstPort="445")])

    assert host_for(result, "10.0.0.5").suggested_kind != pcap_map.KIND_SERVER


# ─── It has to stay a picture ─────────────────────────────────────────────────

def test_a_subnet_scan_is_counted_rather_than_drawn():
    """
    Four hundred icons is not a map. The busiest are kept and the rest are
    reported, which is also the honest way to say "this looks like a scan".
    """
    rows = [packet("10.0.0.1", f"10.0.{i // 250}.{i % 250}") for i in range(400)]

    result = build(rows)

    assert len(result.hosts) == pcap_map.MAX_HOSTS
    assert result.omitted_hosts > 0


def test_a_conversation_to_an_omitted_host_is_dropped_with_it():
    """An edge to an icon that is not drawn would be a line to nowhere."""
    rows = [packet("10.0.0.1", f"10.0.{i // 250}.{i % 250}") for i in range(400)]

    result = build(rows)
    drawn = {host.address for host in result.hosts}

    assert all(c.a in drawn and c.b in drawn for c in result.conversations)


def test_an_empty_capture_is_an_empty_map_not_a_failure():
    result = build([])

    assert result.hosts == [] and result.conversations == []


def test_a_capture_without_the_columns_is_an_empty_map():
    """A CSV artifact that is not a packet list must not raise."""
    assert pcap_map.build_map(FakeStore([]), "x", ["Foo", "Bar"]).hosts == []


# ─── Through the API ──────────────────────────────────────────────────────────

@pytest.fixture()
def case_id(auth_client: TestClient) -> str:
    return auth_client.post("/api/v1/cases/", json={"title": "Capture"}).json()["id"]


def test_naming_a_host_holds_for_the_whole_case(auth_client, case_id):
    """
    Saved against the case rather than the capture: naming 10.0.0.5 while
    reading the first file has named it for every file in the investigation.
    """
    response = auth_client.put(
        f"/api/v1/cases/{case_id}/pcap/map/hosts/10.0.0.5",
        json={"label": "DC-01", "kind": "domain_controller"})

    assert response.status_code == 200
    assert response.json()["label"] == "DC-01"


def test_a_position_is_remembered(auth_client, case_id):
    auth_client.put(f"/api/v1/cases/{case_id}/pcap/map/hosts/10.0.0.5",
                    json={"label": "DC-01"})
    auth_client.put(f"/api/v1/cases/{case_id}/pcap/map/hosts/10.0.0.5",
                    json={"x": 120.5, "y": -40.0})

    saved = auth_client.put(f"/api/v1/cases/{case_id}/pcap/map/hosts/10.0.0.5",
                            json={}).json()

    assert (saved["x"], saved["y"]) == (120.5, -40.0)
    assert saved["label"] == "DC-01", "moving a host forgot its name"


def test_an_unknown_icon_is_refused(auth_client, case_id):
    """The icon vocabulary is AssetType, so an adopted host keeps the word."""
    response = auth_client.put(f"/api/v1/cases/{case_id}/pcap/map/hosts/10.0.0.5",
                               json={"kind": "toaster"})

    assert response.status_code == 400


def test_something_that_is_not_an_address_is_refused(auth_client, case_id):
    response = auth_client.put(
        f"/api/v1/cases/{case_id}/pcap/map/hosts/not-an-ip", json={"label": "x"})

    assert response.status_code == 400


# ─── The case is enriched only when the analyst says so ───────────────────────

def test_reading_the_map_creates_no_assets(auth_client, case_id, db_session):
    """
    The rule that matters most here. A capture of a busy subnet holds hundreds
    of addresses with no bearing on the investigation, and turning them into
    assets automatically would bury the ones that do.
    """
    from app.models.asset import Asset

    auth_client.put(f"/api/v1/cases/{case_id}/pcap/map/hosts/10.0.0.5",
                    json={"label": "DC-01", "kind": "domain_controller"})

    assert db_session.query(Asset).filter(Asset.case_id == case_id).count() == 0


def test_adopting_a_host_creates_the_asset_with_what_the_analyst_named_it(
        auth_client, case_id):
    auth_client.put(f"/api/v1/cases/{case_id}/pcap/map/hosts/10.0.0.5",
                    json={"label": "DC-01", "kind": "domain_controller"})

    created = auth_client.post(
        f"/api/v1/cases/{case_id}/pcap/map/hosts/10.0.0.5/asset", json={}).json()

    assert created["name"] == "DC-01"
    assert created["type"] == "domain_controller"
    assert created["ip_address"] == "10.0.0.5"


def test_adopting_twice_links_rather_than_duplicating(auth_client, case_id, db_session):
    """Two records of one machine is worse than none."""
    from app.models.asset import Asset

    first  = auth_client.post(
        f"/api/v1/cases/{case_id}/pcap/map/hosts/10.0.0.5/asset", json={}).json()
    second = auth_client.post(
        f"/api/v1/cases/{case_id}/pcap/map/hosts/10.0.0.5/asset", json={}).json()

    assert first["id"] == second["id"]
    assert db_session.query(Asset).filter(Asset.case_id == case_id).count() == 1


def test_adopting_is_recorded_in_the_trail(auth_client, case_id, db_session):
    from app.models.audit import AuditLog

    auth_client.post(f"/api/v1/cases/{case_id}/pcap/map/hosts/10.0.0.5/asset",
                     json={"compromised": True})

    entry = db_session.query(AuditLog).filter(
        AuditLog.action == "pcap_map.adopt_asset",
        AuditLog.case_id == case_id).first()

    assert entry is not None
    assert entry.details["address"] == "10.0.0.5"


def test_naming_a_host_is_recorded_but_moving_it_is_not(auth_client, case_id, db_session):
    """
    Naming a host is a judgement about the incident. Dragging it across the
    canvas is not, and auditing every drag would bury the entries that matter
    under a hundred coordinates.
    """
    from app.models.audit import AuditLog

    def entries() -> int:
        return db_session.query(AuditLog).filter(
            AuditLog.action == "pcap_map.annotate",
            AuditLog.case_id == case_id).count()

    auth_client.put(f"/api/v1/cases/{case_id}/pcap/map/hosts/10.0.0.5",
                    json={"label": "Attacker staging"})
    after_naming = entries()

    auth_client.put(f"/api/v1/cases/{case_id}/pcap/map/hosts/10.0.0.5",
                    json={"x": 10.0, "y": 20.0})

    assert after_naming == 1
    assert entries() == 1
