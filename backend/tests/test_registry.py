"""
Browsing a registry hive.

`SOFTWARE`, `SECURITY` and `SAM` were recognised by the pipeline and
deliberately left unparsed: a hive holds thousands of unrelated facts and
choosing which of them matter is an analyst's decision, not a default. Browsing
is the answer that supplies the navigation without making the choice.

These read a hive built byte by byte in `hive_builder.py` rather than a mocked
parser. The thing under test is whether real hive bytes come back as the right
keys and values, and a mock would only test the mock.
"""
from __future__ import annotations

import struct

import pytest

from app.models.ingest import IngestedFile
from app.services import registry as reg
from app.services.ingest import service as ingest_service
from tests.hive_builder import REG_BINARY, REG_DWORD, REG_MULTI_SZ, REG_SZ, Key, build, sample


@pytest.fixture()
def hive(tmp_path):
    """A hive on disk, with the shape the other tests expect."""
    path = tmp_path / "SOFTWARE"
    path.write_bytes(sample())
    return path


@pytest.fixture()
def api_case(auth_client) -> str:
    return auth_client.post("/api/v1/cases", json={"title": "Registry"}).json()["id"]


@pytest.fixture()
def ingested_hive(db_session, api_case, tmp_path):
    """A hive the pipeline has recorded, sitting where its stored_path says."""
    def _make(name: str = "SOFTWARE", data: bytes | None = None) -> IngestedFile:
        path = tmp_path / name
        path.write_bytes(data if data is not None else sample())
        row = ingest_service.record(db_session, case_id=api_case, path=path)
        row.stored_path = str(path)
        db_session.commit()
        return row
    return _make


# ─── Reading the header ───────────────────────────────────────────────────────

def test_a_clean_hive_is_not_reported_as_dirty(hive):
    """
    The flag has to be right in both directions.

    `RegistryHive.dirty` in the library assigns `computed == stored`, which is
    the condition for the hive being *valid*, and calls it dirty. Remora
    computes the checksum itself; this is what proves it did not simply inherit
    that inversion.
    """
    detail = reg.info(hive)
    assert detail.dirty is False
    assert detail.in_transaction is False


def test_a_hive_collected_mid_write_is_reported_as_dirty(tmp_path):
    """
    A dirty hive is read as it stands and said to be dirty.

    Repairing it means replaying the transaction logs, which means writing to
    evidence. The analyst is told the newest values may be missing instead.
    """
    path = tmp_path / "SYSTEM"
    path.write_bytes(build(Key(name="ROOT"), dirty=True))

    assert reg.info(path).dirty is True


def test_the_header_names_the_hive_windows_knew(hive):
    """
    KAPE prefixes a machine name and a timestamp, and a hive pulled from an
    image can be called anything. The header is the one thing that says which
    hive this actually is.
    """
    assert "SYSTEM" in reg.info(hive).internal_name


def test_a_file_that_is_not_a_hive_says_so(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_text("this is not a registry hive")

    with pytest.raises(reg.RegistryError, match="could not be read"):
        reg.info(path)


def test_a_hive_that_is_gone_says_that_rather_than_failing_to_parse(tmp_path):
    with pytest.raises(reg.RegistryError, match="no longer on disk"):
        reg.info(tmp_path / "never-existed")


# ─── Navigating ───────────────────────────────────────────────────────────────

def test_the_root_lists_its_immediate_children_only(hive):
    """One level. A hive holds far too much to send in one response."""
    names = [entry.name for entry in reg.list_keys(hive)]
    assert names == ["Empty", "Microsoft"]          # sorted, case-insensitive


def test_a_key_reports_what_it_holds_so_the_tree_can_draw_itself(hive):
    microsoft = next(e for e in reg.list_keys(hive) if e.name == "Microsoft")
    empty     = next(e for e in reg.list_keys(hive) if e.name == "Empty")

    assert microsoft.subkey_count == 1
    assert empty.subkey_count == 0
    assert empty.value_count == 0
    assert microsoft.last_written is not None


def test_a_path_walks_to_the_key_it_names(hive):
    values = {v.name: v for v in reg.list_values(hive, "Microsoft\\Windows")}
    assert set(values) == {"ProductName", "BuildNumber", "Blob"}


def test_a_forward_slash_path_works_too(hive):
    """Analysts paste paths from both conventions; neither should be an error."""
    assert reg.list_values(hive, "Microsoft/Windows")


def test_a_key_that_does_not_exist_says_so(hive):
    with pytest.raises(reg.RegistryError, match="No such key"):
        reg.list_keys(hive, "Microsoft\\Nope")


# ─── Values ───────────────────────────────────────────────────────────────────

def test_value_types_are_named_not_numbered(hive):
    values = {v.name: v for v in reg.list_values(hive, "Microsoft\\Windows")}

    assert values["ProductName"].type == "REG_SZ"
    assert values["BuildNumber"].type == "REG_DWORD"
    assert values["Blob"].type == "REG_BINARY"


def test_a_string_reads_as_its_text(hive):
    values = {v.name: v for v in reg.list_values(hive, "Microsoft\\Windows")}
    assert values["ProductName"].preview == "Windows 11 Pro"
    assert values["BuildNumber"].preview == "22631"


def test_binary_is_shown_as_hex_not_decoded(hive):
    """
    A `REG_BINARY` holding readable ASCII is still binary. Rendering it as a
    string invents a type the registry did not record.
    """
    values = {v.name: v for v in reg.list_values(hive, "Microsoft\\Windows")}
    assert values["Blob"].preview.startswith("00 01 02 03")


def test_a_multi_string_keeps_its_entries_apart(tmp_path):
    path = tmp_path / "SOFTWARE"
    path.write_bytes(build(Key(name="ROOT", values={
        "Order": (REG_MULTI_SZ, "one\x00two\x00three\x00\x00".encode("utf-16-le")),
    })))

    value = reg.list_values(path)[0]
    assert value.type == "REG_MULTI_SZ"
    assert value.preview.splitlines()[:3] == ["one", "two", "three"]


def test_a_large_value_is_truncated_in_the_listing_and_says_so(tmp_path):
    """
    Opening a key that holds a two-megabyte blob must not send two megabytes to
    draw one table row. The full value is one request further in.
    """
    path = tmp_path / "SOFTWARE"
    path.write_bytes(build(Key(name="ROOT", values={
        "Big": (REG_BINARY, bytes(2000)),
    })))

    value = reg.list_values(path)[0]
    assert value.truncated is True
    assert value.size == 2000
    assert len(value.preview) < 2000 * 3


def test_the_detail_view_returns_both_the_text_and_the_bytes(hive):
    """
    They answer different questions. The text is what the value means; the hex
    is what is stored, which is what an analyst quotes when the two disagree.
    """
    detail = reg.value_detail(hive, "Microsoft\\Windows", "ProductName")

    assert detail["text"] == "Windows 11 Pro"
    assert detail["type"] == "REG_SZ"
    assert detail["hex"].startswith("57 00 69 00")      # "W\0i\0"


def test_a_value_that_does_not_exist_says_so(hive):
    with pytest.raises(reg.RegistryError, match="No such value"):
        reg.value_detail(hive, "Microsoft\\Windows", "Nope")


# ─── Search ───────────────────────────────────────────────────────────────────

def test_search_finds_a_key_by_name(hive):
    result = reg.search(hive, "windows")
    keys = [hit for hit in result.hits if hit.matched == "key"]

    assert any(hit.key_path == "Microsoft\\Windows" for hit in keys)


def test_search_finds_a_value_by_name_and_by_content(hive):
    by_name = reg.search(hive, "ProductName")
    assert any(hit.matched == "value_name" for hit in by_name.hits)

    by_data = reg.search(hive, "11 Pro")
    assert any(hit.matched == "value_data" for hit in by_data.hits)


def test_search_says_which_part_matched(hive):
    """
    A hit on a key name and a hit inside a blob mean very different things, and
    a result list that does not distinguish them makes the analyst open both.
    """
    result = reg.search(hive, "Windows")
    assert {hit.matched for hit in result.hits} <= {"key", "value_name", "value_data"}


def test_search_stops_on_its_limit_and_says_it_did(hive):
    """
    A partial answer that looks complete is worse than a short one that admits
    it. A `SOFTWARE` hive holds hundreds of thousands of keys.
    """
    result = reg.search(hive, "o", limit=1)
    assert len(result.hits) == 1
    assert result.exhausted is True


def test_search_can_be_narrowed_to_key_names(hive):
    result = reg.search(hive, "11 Pro", in_values=False, in_data=False)
    assert result.hits == []


# ─── Through the API ──────────────────────────────────────────────────────────

def test_the_page_lists_the_hives_the_pipeline_ingested(
    auth_client, api_case, ingested_hive
):
    """
    No table of its own. A second list would be a second thing to keep in step,
    and would outlive the collection its files came from.
    """
    ingested_hive("SOFTWARE")
    hives = auth_client.get(f"/api/v1/cases/{api_case}/registry/hives").json()

    assert [h["name"] for h in hives] == ["SOFTWARE"]
    assert hives[0]["available"] is True


def test_the_hive_says_what_it_cannot_do(auth_client, api_case, ingested_hive):
    """
    Registry Explorer replays transaction logs and recovers deleted keys.
    Remora does neither, and an analyst arriving from that tool will assume
    otherwise unless the hive says so.
    """
    row = ingested_hive()
    body = auth_client.get(
        f"/api/v1/cases/{api_case}/registry/hives/{row.id}").json()

    assert body["dirty"] is False
    joined = " ".join(body["limitations"])
    assert "Transaction logs are not replayed" in joined
    assert "Deleted keys" in joined


def test_the_tree_and_the_values_come_back_over_the_api(
    auth_client, api_case, ingested_hive
):
    row = ingested_hive()
    base = f"/api/v1/cases/{api_case}/registry/hives/{row.id}"

    keys = auth_client.get(f"{base}/keys").json()["keys"]
    assert [k["name"] for k in keys] == ["Empty", "Microsoft"]

    values = auth_client.get(f"{base}/values",
                             params={"path": "Microsoft\\Windows"}).json()["values"]
    assert {v["name"] for v in values} == {"ProductName", "BuildNumber", "Blob"}

    detail = auth_client.get(f"{base}/value", params={
        "path": "Microsoft\\Windows", "name": "ProductName"}).json()
    assert detail["text"] == "Windows 11 Pro"


def test_search_over_the_api_reports_whether_it_finished(
    auth_client, api_case, ingested_hive
):
    row = ingested_hive()
    body = auth_client.get(
        f"/api/v1/cases/{api_case}/registry/hives/{row.id}/search",
        params={"q": "ProductName"}).json()

    assert body["exhausted"] is False
    assert body["scanned"] > 0
    assert body["hits"]


def test_a_hive_from_another_case_is_not_found(auth_client, api_case, ingested_hive):
    """
    Scoped in the query, not checked afterwards. A hive id from another
    investigation must not resolve to a path whatever else is true.
    """
    row = ingested_hive()
    other = auth_client.post("/api/v1/cases", json={"title": "Other"}).json()["id"]

    response = auth_client.get(f"/api/v1/cases/{other}/registry/hives/{row.id}/keys")
    assert response.status_code == 404


def test_a_hive_whose_file_is_gone_says_so(
    auth_client, api_case, ingested_hive, db_session
):
    row = ingested_hive()
    from pathlib import Path
    Path(str(row.stored_path)).unlink()

    listed = auth_client.get(f"/api/v1/cases/{api_case}/registry/hives").json()
    assert listed[0]["available"] is False

    response = auth_client.get(
        f"/api/v1/cases/{api_case}/registry/hives/{row.id}/keys")
    assert response.status_code == 410
    assert "no longer on disk" in response.json()["detail"]


def test_a_file_that_is_not_a_hive_is_refused_not_crashed(
    auth_client, api_case, ingested_hive
):
    row = ingested_hive("SYSTEM", data=b"regf" + b"\x00" * 8192)

    response = auth_client.get(f"/api/v1/cases/{api_case}/registry/hives/{row.id}")
    assert response.status_code == 422


def test_the_pipeline_no_longer_calls_a_hive_a_failure(
    db_session, api_case, ingested_hive
):
    """
    A `SOFTWARE` hive has no Eric Zimmerman tool and needs none. Reporting that
    as `failed` put a red row in the ingest queue for a file that had arrived
    exactly where it belongs.
    """
    from app.models.ingest import STATE_BROWSABLE
    from app.services.ingest import dispatch

    row = ingested_hive("SOFTWARE")
    from pathlib import Path
    result = dispatch.parse(db_session, case_id=api_case,
                            path=Path(str(row.stored_path)), filename="SOFTWARE")

    assert result.state == STATE_BROWSABLE
    assert "Registry Explorer" in (result.error or "")


def test_a_dword_survives_the_round_trip(tmp_path):
    """A number read as a string would be a filter that never matches."""
    path = tmp_path / "SYSTEM"
    path.write_bytes(build(Key(name="ROOT", values={
        "Start": (REG_DWORD, struct.pack("<I", 4)),
    })))

    assert reg.list_values(path)[0].preview == "4"


def test_an_empty_string_value_is_still_a_value(tmp_path):
    path = tmp_path / "SYSTEM"
    path.write_bytes(build(Key(name="ROOT", values={"Blank": (REG_SZ, b"")})))

    values = reg.list_values(path)
    assert len(values) == 1
    assert values[0].name == "Blank"
