"""
The three groups that made up 43% of a real triage and reached nothing.

Measured on the reference collection (`docs/COVERAGE.md`): 538 Recycle Bin
records, 272 scheduled tasks and 79 custom jump lists, all either unidentified
or - worse - identified as something else. Two of the three already had a
parser waiting; what was missing was identification.

These tests are about **why** each one is now recognised. All three are matched
on content rather than on a filename or a folder, because a collection method
that is not KAPE names things differently and an analyst who exports artifacts
by hand names them worse.
"""
from __future__ import annotations

import struct

import pytest

from app.services.ingest import ez_parsers
from app.services.ingest.identify import identify
from app.services.ingest.python_parsers import scheduled_tasks as st
from app.services.ingest.routing import route_for

# A shell link header: the size field, then the LinkCLSID.
LNK_HEADER = bytes.fromhex("4c000000") + bytes.fromhex("0114020000000000c000000000000046")

TASK_XML = """<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>NT AUTHORITY\\SYSTEM</Author>
    <Description>Keeps things running</Description>
    <URI>\\Microsoft\\Windows\\Backdoor</URI>
    <Date>2026-01-02T03:04:05</Date>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled></LogonTrigger>
    <CalendarTrigger>
      <StartBoundary>2026-07-13T23:32:50Z</StartBoundary>
      <Repetition><Interval>PT1H</Interval></Repetition>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>NT AUTHORITY\\SYSTEM</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings><Enabled>true</Enabled><Hidden>true</Hidden></Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\\Windows\\System32\\cmd.exe</Command>
      <Arguments>/c whoami</Arguments>
      <WorkingDirectory>C:\\</WorkingDirectory>
    </Exec>
    <Exec><Command>powershell.exe</Command><Arguments>-enc AAA=</Arguments></Exec>
  </Actions>
</Task>
"""


def recycle_record(path: str = "C:\\Users\\fsali\\Documents\\secret.docx",
                   size: int = 8_358_984, version: int = 2) -> bytes:
    """A `$I` record, built the way Windows writes one."""
    encoded = (path + "\x00").encode("utf-16-le")
    filetime = 133_000_000_000_000_000
    if version == 1:
        # Fixed 544 bytes: 24 of header, then a 260-character path field.
        body = encoded.ljust(520, b"\x00")[:520]
        return struct.pack("<QQQ", 1, size, filetime) + body
    return (struct.pack("<QQQ", 2, size, filetime)
            + struct.pack("<I", len(encoded) // 2) + encoded)


def task_bytes(xml: str = TASK_XML) -> bytes:
    """As Windows stores it: UTF-16 with a byte-order mark."""
    return b"\xff\xfe" + xml.encode("utf-16-le")


# ─── Recycle Bin ──────────────────────────────────────────────────────────────

def test_a_recycle_bin_record_is_recognised_despite_its_extension(tmp_path):
    """
    The reason 223 of them were classified as archives.

    A `$I` file is named after the **deleted** file, so `$IZJNHSA.zip` is 212
    bytes of metadata about a deleted ZIP and not a ZIP at all. Trusting the
    extension sent them to the archive unpacker, which found nothing in them.
    """
    path = tmp_path / "$IZJNHSA.zip"
    path.write_bytes(recycle_record())

    assert identify(path).kind == "recycle_bin"


@pytest.mark.parametrize("name", ["$IZUAP07.stl", "$I0M4DZ7.jpeg", "anything", "$I0BK77W.rar"])
def test_the_name_does_not_decide_it(tmp_path, name):
    path = tmp_path / name
    path.write_bytes(recycle_record())
    assert identify(path).kind == "recycle_bin"


def test_the_older_fixed_length_format_is_recognised_too(tmp_path):
    """Windows Vista through 8.1 wrote a fixed 544-byte record."""
    path = tmp_path / "$IOLD.txt"
    path.write_bytes(recycle_record(version=1))

    assert identify(path).kind == "recycle_bin"
    assert len(recycle_record(version=1)) == 544


def test_a_record_whose_fields_do_not_add_up_is_refused(tmp_path):
    """
    The header is a version number, not a magic. Plenty of files begin with a
    small integer, so the structural check is the whole of what makes this
    detection trustworthy.
    """
    raw = bytearray(recycle_record())
    struct.pack_into("<I", raw, 24, 9999)          # claim a path far longer
    path = tmp_path / "$IBROKEN.zip"
    path.write_bytes(bytes(raw))

    assert identify(path).kind != "recycle_bin"


def test_an_empty_jump_list_is_not_mistaken_for_a_recycle_bin_record(tmp_path):
    """
    A real collision, found in the reference triage.

    An empty `customDestinations-ms` is twelve bytes beginning
    `02 00 00 00 00 00 00 00` - byte for byte the header of a version 2 `$I`
    record. Only the structural check tells them apart.
    """
    path = tmp_path / "264513456643c3ad.customDestinations-ms"
    path.write_bytes(bytes.fromhex("020000000000000000000000"))

    assert identify(path).kind == "jumplist_custom"


def test_a_deleted_path_that_is_not_a_windows_path_is_refused(tmp_path):
    path = tmp_path / "$INOPE.zip"
    encoded = "not a path at all\x00".encode("utf-16-le")
    path.write_bytes(struct.pack("<QQQ", 2, 1, 1)
                     + struct.pack("<I", len(encoded) // 2) + encoded)

    assert identify(path).kind != "recycle_bin"


def test_the_recycle_bin_reaches_a_parser_and_the_explorer():
    route = route_for("recycle_bin")
    assert route.parser == "rbcmd"
    assert route.to_explorer
    assert "recycle_bin" in ez_parsers.BATCH_KINDS


# ─── Custom jump lists ────────────────────────────────────────────────────────

def test_a_jump_list_caught_mid_write_is_still_a_jump_list(tmp_path):
    """
    52 of the 79 in the reference triage are named `.tmp` or `.temp`, and every
    one of them holds real link data. Keying on the extension found a third.
    """
    path = tmp_path / "1b4dd67f29cb1962.tmp"
    path.write_bytes(b"\x02\x00\x00\x00\x02\x00\x00\x00" + b"\x00" * 12
                     + LNK_HEADER + b"\x00" * 64 + bytes.fromhex("abfbbfba"))

    assert identify(path).kind == "jumplist_custom"


def test_a_plain_shortcut_is_not_a_jump_list(tmp_path):
    """A link at offset zero is a `.lnk`. Only an embedded one is a jump list."""
    path = tmp_path / "Recent.lnk"
    path.write_bytes(LNK_HEADER + b"\x00" * 128)

    assert identify(path).kind == "lnk"


def test_a_jump_list_with_no_links_falls_back_to_its_extension(tmp_path):
    """
    Nothing in the content distinguishes it, so the name is all there is. A
    fallback, not the rule - which is why the test says so.
    """
    path = tmp_path / "abc.customDestinations-ms"
    path.write_bytes(bytes.fromhex("020000000000000000000000"))

    result = identify(path)
    assert result.kind == "jumplist_custom"


# ─── Scheduled tasks ──────────────────────────────────────────────────────────

def test_a_scheduled_task_is_recognised_with_no_extension(tmp_path):
    """
    266 of the 272 in the reference triage have no extension at all, and they
    live under `System32\\Tasks` - a path a non-KAPE collection will not
    reproduce. The schema in the content is what identifies them.
    """
    path = tmp_path / "GoogleUpdaterTaskSystem"
    path.write_bytes(task_bytes())

    assert identify(path).kind == "scheduled_task"


def test_utf16_xml_that_is_not_a_task_is_not_claimed(tmp_path):
    """
    The signature is a byte-order mark and `<?x`, which every UTF-16 XML
    document in existence begins with. The schema check is what stops this
    swallowing them.
    """
    path = tmp_path / "settings.xml"
    path.write_bytes(b"\xff\xfe" + '<?xml version="1.0"?><Config><A/></Config>'
                     .encode("utf-16-le"))

    assert identify(path).kind != "scheduled_task"


def test_a_task_produces_one_row_per_action(tmp_path):
    """
    The question is "what runs?", so the command has to be the thing being
    filtered on. A task with two actions is two rows.
    """
    path = tmp_path / "Backdoor"
    path.write_bytes(task_bytes())

    task = st.parse(path)
    rows = st._rows(task)

    assert len(rows) == 2
    commands = [r[st.COLUMNS.index("Command")] for r in rows]
    assert commands == ["C:\\Windows\\System32\\cmd.exe", "powershell.exe"]


def test_a_task_carries_who_it_runs_as_and_when(tmp_path):
    path = tmp_path / "Backdoor"
    path.write_bytes(task_bytes())

    task = st.parse(path)

    assert task.name == "Backdoor"
    assert task.uri == "\\Microsoft\\Windows\\Backdoor"
    assert task.run_as == "NT AUTHORITY\\SYSTEM"
    assert task.run_level == "HighestAvailable"
    assert task.hidden == "true"
    assert task.registered == "2026-01-02T03:04:05"


def test_triggers_are_summarised_with_their_schedule(tmp_path):
    """
    Nine trigger types with almost nothing in common structurally. A column per
    type would be a table that is mostly empty; what an analyst needs is when.
    """
    path = tmp_path / "Backdoor"
    path.write_bytes(task_bytes())

    task = st.parse(path)
    joined = "; ".join(task.triggers)

    assert "LogonTrigger" in joined
    assert "from 2026-07-13T23:32:50Z" in joined
    assert "every PT1H" in joined


def test_a_disabled_trigger_says_so(tmp_path):
    """A disabled trigger on a live task is a different fact from an active one."""
    xml = TASK_XML.replace("<LogonTrigger><Enabled>true</Enabled></LogonTrigger>",
                           "<LogonTrigger><Enabled>false</Enabled></LogonTrigger>")
    path = tmp_path / "Backdoor"
    path.write_bytes(task_bytes(xml))

    assert "(disabled)" in st.parse(path).triggers[0]


def test_a_com_handler_records_the_class_it_runs(tmp_path):
    """
    Half the actions in a real triage are COM handlers. Recording only `Exec`
    would hide them, and a hidden action is the one worth finding.
    """
    xml = TASK_XML.replace(
        "<Exec>\n      <Command>C:\\Windows\\System32\\cmd.exe</Command>\n"
        "      <Arguments>/c whoami</Arguments>\n"
        "      <WorkingDirectory>C:\\</WorkingDirectory>\n    </Exec>",
        "<ComHandler><ClassId>{12345678-1234-1234-1234-123456789abc}</ClassId></ComHandler>")
    path = tmp_path / "Backdoor"
    path.write_bytes(task_bytes(xml))

    kinds = [a.kind for a in st.parse(path).actions]
    assert "ComHandler" in kinds


def test_a_task_that_will_not_parse_is_named_in_the_output(tmp_path):
    """
    A silent omission from a persistence table is the wrong kind of quiet.
    """
    good = tmp_path / "Good"
    good.write_bytes(task_bytes())
    bad = tmp_path / "Bad"
    bad.write_bytes(b"\xff\xfe" + "<?xml ?><Task xmlns='http://schemas.microsoft.com/"
                    "windows/2004/02/mit/task'><unclosed>".encode("utf-16-le"))

    written = st.parse_all([good, bad], tmp_path / "out", base=tmp_path)
    names = {p.name for p in written}

    assert names == {"scheduled_tasks.csv", "scheduled_tasks_errors.csv"}
    assert "Bad" in (tmp_path / "out" / "scheduled_tasks_errors.csv").read_text()


def test_the_source_column_says_where_the_task_sat(tmp_path):
    """
    Not just what it was called. A task in a user profile and one in
    `System32\\Tasks` are different facts, and 266 of them share the shape of
    their name.
    """
    nested = tmp_path / "C" / "Windows" / "System32" / "Tasks" / "Sub"
    nested.mkdir(parents=True)
    path = nested / "Thing"
    path.write_bytes(task_bytes())

    task = st.parse(path, base=tmp_path)
    assert task.source == "C/Windows/System32/Tasks/Sub/Thing"


# ─── Staging for the directory-reading tools ──────────────────────────────────

def test_staging_keeps_the_account_that_deleted_the_file(tmp_path):
    """
    A `$I` record sits under the SID of the account that deleted the file.
    Flattening 538 of them into one directory throws that away, and RBCmd
    reports the path it read - so mirroring the tree is what preserves it.
    """
    source = tmp_path / "C" / "$Recycle.Bin" / "S-1-5-21-999" / "$IZUAP07.stl"
    source.parent.mkdir(parents=True)
    source.write_bytes(recycle_record())

    staged = tmp_path / "staged"
    ez_parsers.stage_for_batch(source, staged, tmp_path, None)

    assert (staged / "C" / "$Recycle.Bin" / "S-1-5-21-999" / "$IZUAP07.stl").exists()


def test_staging_appends_the_extension_a_tool_needs_without_losing_the_name(tmp_path):
    """
    JLECmd decides what to read from the extension, so a `.tmp` jump list is
    walked past. Appended rather than replaced: the original name has to
    survive into the tool's own source column.
    """
    source = tmp_path / "1b4dd67f29cb1962.tmp"
    source.write_bytes(b"\x00" * 16)

    staged = tmp_path / "staged"
    ez_parsers.stage_for_batch(source, staged, tmp_path, ".customDestinations-ms")

    assert (staged / "1b4dd67f29cb1962.tmp.customDestinations-ms").exists()


def test_a_file_outside_the_collection_still_stages(tmp_path):
    """A file dropped on its own has no tree to mirror. It must not be lost."""
    source = tmp_path / "elsewhere" / "$IZUAP07.stl"
    source.parent.mkdir()
    source.write_bytes(recycle_record())

    staged = tmp_path / "staged"
    ez_parsers.stage_for_batch(source, staged, tmp_path / "somewhere-else", None)

    assert (staged / "$IZUAP07.stl").exists()
