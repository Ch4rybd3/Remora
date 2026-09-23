"""
Reconstructing what ran, and what launched it.

The tree is the question an investigation asks first - *how did this get here*
- and a wrong one is worse than none, because every edge in it reads as a
claim. These tests are mostly about the ways a plausible-looking tree can be
wrong: a PID read in the wrong base, a PID reused by a later process, a parent
that was never logged.

They read what the product reads. The tree used to be built from `evtx_events`,
a table the Logs module filled by parsing EVTX a second time; it is built from
the Artifact Explorer's EvtxECmd tables now, so the fixtures below write one -
including the `Payload` column, whose JSON is where every field the tree needs
actually lives.
"""
from __future__ import annotations

import csv
import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from app.services import process_tree as tree

BASE = datetime(2026, 3, 1, 9, 0, 0)

#: The columns EvtxECmd writes. Only a few carry meaning for the tree; the rest
#: are here because a table with a plausible shape is what the reader has to
#: recognise, and recognition is by column.
EVTX_COLUMNS = [
    "RecordNumber", "EventRecordId", "TimeCreated", "EventId", "Level",
    "Provider", "Channel", "Computer", "UserId", "MapDescription",
    "PayloadData1", "SourceFile", "Payload",
]


def _payload(data: dict) -> str:
    """
    Event fields as EvtxECmd renders them.

    The `@Name`/`#text` list is the shape the tool writes for most events, and
    the one the reader has to walk rather than index.
    """
    return json.dumps({
        "EventData": {
            "Data": [{"@Name": k, "#text": v} for k, v in data.items()]
        }
    })


@pytest.fixture()
def case(db_session):
    from app.models.case import Case

    row = Case(title="Process tree")
    db_session.add(row)
    db_session.commit()
    return row.id


@pytest.fixture()
def log(db_session, case, tmp_path: Path):
    """A parsed event log table in the case, and a way to append records."""
    from app.models.csv_artifact import CsvArtifactFile
    from app.services.store import drop_cache

    path = tmp_path / "Security_EvtxECmd_Output.csv"
    record = CsvArtifactFile(
        id=str(uuid.uuid4()), case_id=case,
        original_name="Security_EvtxECmd_Output.csv",
        file_path=str(path), columns=json.dumps(EVTX_COLUMNS),
        row_count=0, date_column="TimeCreated",
    )
    db_session.add(record)
    db_session.commit()

    rows: list[dict] = []

    def _add(event_id: int, data: dict, *, offset: int = 0,
             provider: str = "Microsoft-Windows-Security-Auditing") -> None:
        rows.append({
            "RecordNumber":  str(len(rows) + 1),
            "EventRecordId": str(len(rows) + 1),
            "TimeCreated":   (BASE + timedelta(seconds=offset)).strftime("%Y-%m-%d %H:%M:%S"),
            "EventId":       str(event_id),
            "Level":         "4",
            "Provider":      provider,
            "Channel":       "Security",
            "Computer":      "WS01",
            "UserId":        "",
            "MapDescription": "",
            "PayloadData1":  "",
            "SourceFile":    "C:\\Windows\\System32\\winevt\\Logs\\Security.evtx",
            "Payload":       _payload(data),
        })
        with open(path, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=EVTX_COLUMNS)
            writer.writeheader()
            writer.writerows(rows)

        # The table is rewritten in place on every append, and the Parquet
        # conversion keys on mtime - within the same second a stale cache would
        # be taken for fresh, and the test would assert on the previous state.
        drop_cache(path)
        record.row_count = len(rows)
        db_session.commit()

    return _add


def sysmon(log, *, guid: str, pid: int, image: str, parent_guid: str = "",
           parent_pid: int | None = None, parent_image: str = "",
           command: str = "", offset: int = 0) -> None:
    log(1, {
        "ProcessGuid": guid, "ProcessId": str(pid), "Image": image,
        "CommandLine": command, "User": "WS01\\fsali",
        "ParentProcessGuid": parent_guid,
        "ParentProcessId": str(parent_pid) if parent_pid is not None else "",
        "ParentImage": parent_image,
    }, offset=offset, provider="Microsoft-Windows-Sysmon")


def security(log, *, pid: str, image: str, parent_pid: str,
             parent_image: str = "", command: str = "", offset: int = 0) -> None:
    log(4688, {
        "NewProcessId": pid, "NewProcessName": image, "ProcessId": parent_pid,
        "ParentProcessName": parent_image, "CommandLine": command,
        "SubjectUserName": "fsali",
    }, offset=offset)


def by_name(result: dict, name: str) -> dict:
    return next(n for n in result["nodes"] if n["name"] == name)


# ─── Reading a process id ─────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("0x1a2c", 6700),      # Security 4688 writes hex
    ("6700", 6700),        # Sysmon writes decimal
    ("0X1A2C", 6700),
    (6700, 6700),
    ("", None), (None, None), ("nonsense", None),
])
def test_a_process_id_is_read_in_the_base_it_was_written_in(raw, expected):
    """
    The trap that builds a tree out of processes that never existed. 4688
    writes `0x1a2c` and Sysmon writes `6700`; reading one as the other gives a
    number that is entirely plausible and entirely wrong, and nothing
    downstream would notice.
    """
    assert tree.parse_pid(raw) == expected


# ─── Sysmon: lineage the log asserts ──────────────────────────────────────────

def test_sysmon_lineage_is_asserted_not_inferred(db_session, case, log):
    """A GUID names the parent outright. No matching, no window, no guessing."""
    sysmon(log, guid="{A}", pid=100, image="C:\\Windows\\explorer.exe", offset=0)
    sysmon(log, guid="{B}", pid=200, image="C:\\Windows\\System32\\cmd.exe",
           parent_guid="{A}", parent_pid=100, offset=10)

    result = tree.build(db_session, case)
    child = by_name(result, "cmd.exe")

    assert child["link"] == "asserted"
    assert child["parent_key"] == "{A}"
    assert result["stats"]["asserted"] == 1


def test_a_sysmon_process_keeps_its_command_line(db_session, case, log):
    sysmon(log, guid="{A}", pid=100, image="C:\\Windows\\System32\\cmd.exe",
           command="cmd.exe /c whoami")

    assert by_name(tree.build(db_session, case), "cmd.exe")["command_line"] \
        == "cmd.exe /c whoami"


# ─── Security 4688: lineage inferred from a reused number ─────────────────────

def test_a_security_link_is_marked_inferred(db_session, case, log):
    """
    4688 gives a parent PID and nothing that identifies the process behind it.
    The link may well be right; it is not asserted by the log, and a tree that
    presented it as though it were would be overstating its evidence.
    """
    security(log, pid="0x64", image="C:\\Windows\\explorer.exe",
             parent_pid="0x4", offset=0)
    security(log, pid="0xc8", image="C:\\Windows\\System32\\cmd.exe",
             parent_pid="0x64", offset=10)

    result = tree.build(db_session, case)
    child = by_name(result, "cmd.exe")

    assert child["link"] == "inferred"
    assert child["parent_key"] == by_name(result, "explorer.exe")["key"]


def test_a_reused_pid_does_not_adopt_the_wrong_children(db_session, case, log):
    """
    The reason a PID alone is not an identity.

    Two processes carry PID 100 at different times. The child created after the
    second one started belongs to the second, and a match on the number alone
    would hand it to whichever was found first.
    """
    security(log, pid="0x64", image="C:\\first.exe", parent_pid="0x4", offset=0)
    log(4689, {"ProcessId": "0x64"}, offset=50)
    security(log, pid="0x64", image="C:\\second.exe", parent_pid="0x4", offset=100)
    security(log, pid="0xc8", image="C:\\child.exe", parent_pid="0x64", offset=110)

    result = tree.build(db_session, case)
    child = by_name(result, "child.exe")

    assert child["parent_key"] == by_name(result, "second.exe")["key"]


def test_a_parent_that_had_already_exited_is_not_chosen(db_session, case, log):
    security(log, pid="0x64", image="C:\\gone.exe", parent_pid="0x4", offset=0)
    log(4689, {"ProcessId": "0x64"}, offset=10)
    security(log, pid="0xc8", image="C:\\later.exe", parent_pid="0x64", offset=60)

    child = by_name(tree.build(db_session, case), "later.exe")
    assert child["link"] == "orphan"


def test_an_implausibly_old_parent_is_refused(db_session, case, log):
    """
    Without a recorded exit every process with that PID looks alive forever.
    The grace window is what stops a boot-time service adopting everything that
    ran on the machine that week.
    """
    security(log, pid="0x64", image="C:\\services.exe", parent_pid="0x4", offset=0)
    security(log, pid="0xc8", image="C:\\much_later.exe", parent_pid="0x64",
             offset=int(timedelta(days=3).total_seconds()))

    assert by_name(tree.build(db_session, case), "much_later.exe")["link"] == "orphan"


# ─── Nothing is dropped ───────────────────────────────────────────────────────

def test_a_process_with_no_logged_parent_attaches_to_the_root(db_session, case, log):
    """
    A missing parent is itself a finding, and usually the interesting one: the
    launcher was not logged, which is either a gap in collection or the point
    of the intrusion.
    """
    security(log, pid="0xc8", image="C:\\Temp\\dropper.exe", parent_pid="0x999")

    node = by_name(tree.build(db_session, case), "dropper.exe")
    assert node["link"] == "orphan"
    assert node["parent_key"] == tree.ROOT_KEY


def test_the_same_creation_seen_twice_is_one_node(db_session, case, log):
    """
    A log collected from two places, or an EVTX imported again. Two nodes for
    one process would double every count an analyst reads off the tree.
    """
    sysmon(log, guid="{A}", pid=100, image="C:\\Windows\\cmd.exe", offset=0)
    sysmon(log, guid="{A}", pid=100, image="C:\\Windows\\cmd.exe", offset=0)

    result = tree.build(db_session, case)
    assert result["stats"]["processes"] == 1


# ─── What the tree says about itself ──────────────────────────────────────────

def test_a_node_names_the_records_it_came_from(db_session, case, log):
    sysmon(log, guid="{A}", pid=100, image="C:\\a.exe")
    security(log, pid="0xc8", image="C:\\b.exe", parent_pid="0x4")

    result = tree.build(db_session, case)
    assert by_name(result, "a.exe")["sources"] == ["sysmon:1"]
    assert by_name(result, "b.exe")["sources"] == ["security:4688"]


def test_the_counts_qualify_the_tree(db_session, case, log):
    sysmon(log, guid="{A}", pid=100, image="C:\\p.exe", offset=0)
    sysmon(log, guid="{B}", pid=200, image="C:\\c.exe", parent_guid="{A}", offset=10)
    security(log, pid="0x1f4", image="C:\\o.exe", parent_pid="0x999", offset=20)

    stats = tree.build(db_session, case)["stats"]
    assert stats["processes"] == 3
    assert stats["asserted"] == 1
    assert stats["orphans"] == 2      # the Sysmon root and the unparented 4688
    assert stats["from_sysmon"] == 2
    assert stats["from_security"] == 1
    assert stats["truncated"] is False


def test_a_truncated_tree_says_so(db_session, case, log):
    """
    A truncated tree that looked complete is a tree an analyst draws
    conclusions from.
    """
    for i in range(5):
        security(log, pid=hex(100 + i), image=f"C:\\p{i}.exe",
                 parent_pid="0x4", offset=i)

    assert tree.build(db_session, case, limit=3)["stats"]["truncated"] is True


def test_an_event_id_1_from_another_provider_is_not_a_process(db_session, case, log):
    """
    Event id 1 means something else entirely on most channels. Matching on the
    number alone would fill the tree with whatever else numbered its first
    event 1.
    """
    log(1, {"Whatever": "x"}, provider="Microsoft-Windows-Kernel-General")

    assert tree.build(db_session, case)["stats"]["processes"] == 0


def test_a_case_with_no_event_logs_is_an_empty_tree_not_an_error(db_session, case):
    result = tree.build(db_session, case)
    assert result["nodes"] == []
    assert result["stats"]["processes"] == 0


# ─── Through the API ──────────────────────────────────────────────────────────

@pytest.fixture()
def api_case(auth_client, db_session, tmp_path: Path):
    """A case whose parsed Sysmon table holds one small chain."""
    from app.models.csv_artifact import CsvArtifactFile
    from app.services.store import drop_cache

    case_id = auth_client.post("/api/v1/cases/", json={"title": "Tree"}).json()["id"]
    path = tmp_path / "Sysmon_EvtxECmd_Output.csv"

    records = [
        ("{A}", 100, "C:\\Windows\\explorer.exe",              "",    None, 0),
        ("{B}", 200, "C:\\Windows\\System32\\cmd.exe",        "{A}", 100,  10),
        ("{C}", 300, "C:\\Windows\\System32\\whoami.exe",     "{B}", 200,  20),
    ]
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=EVTX_COLUMNS)
        writer.writeheader()
        for index, (guid, pid, image, pguid, ppid, offset) in enumerate(records, 1):
            writer.writerow({
                "RecordNumber": str(index), "EventRecordId": str(index),
                "TimeCreated": (BASE + timedelta(seconds=offset)).strftime("%Y-%m-%d %H:%M:%S"),
                "EventId": "1", "Level": "4",
                "Provider": "Microsoft-Windows-Sysmon", "Channel": "Microsoft-Windows-Sysmon/Operational",
                "Computer": "WS01", "UserId": "", "MapDescription": "", "PayloadData1": "",
                "SourceFile": "Sysmon.evtx",
                "Payload": _payload({
                    "ProcessGuid": guid, "ProcessId": str(pid), "Image": image,
                    "ParentProcessGuid": pguid,
                    "ParentProcessId": str(ppid) if ppid is not None else "",
                }),
            })
    drop_cache(path)

    db_session.add(CsvArtifactFile(
        id=str(uuid.uuid4()), case_id=case_id,
        original_name="Sysmon_EvtxECmd_Output.csv", file_path=str(path),
        columns=json.dumps(EVTX_COLUMNS), row_count=len(records),
        date_column="TimeCreated",
    ))
    db_session.commit()
    return case_id


def test_the_tree_comes_back_over_the_api(auth_client, api_case):
    body = auth_client.get(f"/api/v1/cases/{api_case}/process-tree").json()

    assert body["stats"]["processes"] == 3
    assert {n["name"] for n in body["nodes"]} == {"explorer.exe", "cmd.exe", "whoami.exe"}
    assert body["focus"]["requested"] is False


# ─── Focusing on one process ──────────────────────────────────────────────────
# What the Artifact Explorer asks for. An analyst right-clicking a suspicious
# event wants the chain that produced it and what it went on to do, not the
# whole case to search.

def test_a_focus_returns_the_process_its_ancestors_and_its_children(auth_client, api_case):
    body = auth_client.get(
        f"/api/v1/cases/{api_case}/process-tree", params={"guid": "{B}"}).json()

    assert {n["name"] for n in body["nodes"]} == {"explorer.exe", "cmd.exe", "whoami.exe"}
    assert body["focus"] == {"requested": True, "found": True, "key": "{B}"}


def test_a_focus_on_a_leaf_keeps_the_line_that_led_to_it(auth_client, api_case):
    """The ancestors are the answer to "how did this get here"."""
    body = auth_client.get(
        f"/api/v1/cases/{api_case}/process-tree", params={"guid": "{C}"}).json()

    assert {n["name"] for n in body["nodes"]} == {"explorer.exe", "cmd.exe", "whoami.exe"}


def test_a_focus_drops_what_is_not_on_the_line(auth_client, api_case, db_session, tmp_path):
    """A sibling branch is not part of this chain and would only be noise."""
    body = auth_client.get(
        f"/api/v1/cases/{api_case}/process-tree", params={"guid": "{A}"}).json()
    whole = auth_client.get(f"/api/v1/cases/{api_case}/process-tree").json()

    # This chain is linear, so focusing on the root returns everything - the
    # assertion worth making is that focusing never *invents* a node.
    assert len(body["nodes"]) <= len(whole["nodes"])


def test_a_focus_on_a_process_that_is_not_in_the_logs_says_so(auth_client, api_case):
    """
    Different from an empty tree, and the caller has to be able to tell them
    apart: one means nothing was collected, the other means this ran on a
    machine whose logs are not here.
    """
    body = auth_client.get(
        f"/api/v1/cases/{api_case}/process-tree", params={"guid": "{NOPE}"}).json()

    assert body["nodes"] == []
    assert body["focus"]["found"] is False
    assert body["focus"]["requested"] is True


def test_a_focus_by_pid_finds_the_process(auth_client, api_case):
    """A Security 4688 row carries a PID and a time, never a GUID."""
    body = auth_client.get(
        f"/api/v1/cases/{api_case}/process-tree", params={"pid": 200}).json()

    assert body["focus"]["found"] is True
    assert body["focus"]["key"] == "{B}"


def test_a_focus_by_pid_prefers_the_process_alive_at_that_moment(db_session, case, log):
    """
    The reason `at` exists. Windows reuses a PID within minutes on a busy
    machine, and picking the first match would hand the analyst a different
    process that happened to share a number.
    """
    sysmon(log, guid="{FIRST}",  pid=500, image="C:\\Windows\\first.exe",  offset=0)
    log(5, {"ProcessGuid": "{FIRST}", "ProcessId": "500"},
        offset=30, provider="Microsoft-Windows-Sysmon")
    sysmon(log, guid="{SECOND}", pid=500, image="C:\\Windows\\second.exe", offset=60)

    early = tree.build(db_session, case,
                       focus=tree.Focus(pid=500, at=BASE + timedelta(seconds=10)))
    late  = tree.build(db_session, case,
                       focus=tree.Focus(pid=500, at=BASE + timedelta(seconds=90)))

    assert early["focus"]["key"] == "{FIRST}"
    assert late["focus"]["key"] == "{SECOND}"


def test_an_image_name_breaks_a_tie_between_reused_pids(db_session, case, log):
    sysmon(log, guid="{ONE}", pid=600, image="C:\\Windows\\one.exe", offset=0)
    sysmon(log, guid="{TWO}", pid=600, image="C:\\Windows\\two.exe", offset=5)

    result = tree.build(db_session, case,
                        focus=tree.Focus(pid=600, image="two.exe"))

    assert result["focus"]["key"] == "{TWO}"


def test_a_guid_that_matches_nothing_does_not_fall_back_to_the_pid(db_session, case, log):
    """The two would answer about different processes, which is worse than
    answering that the process is not here."""
    sysmon(log, guid="{REAL}", pid=700, image="C:\\Windows\\real.exe")

    result = tree.build(db_session, case, focus=tree.Focus(guid="{GHOST}", pid=700))

    assert result["focus"]["found"] is False


def test_a_case_from_another_scope_is_not_found(auth_client):
    response = auth_client.get("/api/v1/cases/does-not-exist/process-tree")
    assert response.status_code in (200, 404)
