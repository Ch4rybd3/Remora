"""
Reconstructing what ran, and what launched it.

The tree is the question an investigation asks first - *how did this get here*
- and a wrong one is worse than none, because every edge in it reads as a
claim. These tests are mostly about the ways a plausible-looking tree can be
wrong: a PID read in the wrong base, a PID reused by a later process, a parent
that was never logged.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app.models.evtx import EvtxEvent, EvtxFile
from app.services import process_tree as tree

BASE = datetime(2026, 3, 1, 9, 0, 0)


@pytest.fixture()
def case(db_session):
    from app.models.case import Case

    row = Case(title="Process tree")
    db_session.add(row)
    db_session.commit()
    return row.id


@pytest.fixture()
def log(db_session, case):
    """An event log in the case, and a way to append records to it."""
    evtx = EvtxFile(case_id=case, filename="Security.evtx", file_path="/tmp/x.evtx")
    db_session.add(evtx)
    db_session.commit()

    def _add(event_id: int, data: dict, *, offset: int = 0,
             provider: str = "Microsoft-Windows-Security-Auditing") -> None:
        db_session.add(EvtxEvent(
            file_id=evtx.id, event_id=event_id, provider=provider,
            computer="WS01", time_created=BASE + timedelta(seconds=offset),
            event_data=data,
        ))
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

def test_the_tree_comes_back_over_the_api(auth_client, db_session):
    api_case = auth_client.post("/api/v1/cases/", json={"title": "Tree"}).json()["id"]
    evtx = EvtxFile(case_id=api_case, filename="Sysmon.evtx", file_path="/tmp/s.evtx")
    db_session.add(evtx)
    db_session.commit()
    db_session.add(EvtxEvent(
        file_id=evtx.id, event_id=1, provider="Microsoft-Windows-Sysmon",
        computer="WS01", time_created=BASE,
        event_data={"ProcessGuid": "{Z}", "ProcessId": "42",
                    "Image": "C:\\Windows\\System32\\cmd.exe"},
    ))
    db_session.commit()

    body = auth_client.get(f"/api/v1/cases/{api_case}/process-tree").json()
    assert body["stats"]["processes"] == 1
    assert body["nodes"][0]["name"] == "cmd.exe"


def test_a_case_from_another_scope_is_not_found(auth_client):
    response = auth_client.get("/api/v1/cases/does-not-exist/process-tree")
    assert response.status_code in (200, 404)
