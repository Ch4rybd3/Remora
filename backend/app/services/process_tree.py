"""
Reconstructing what ran, and what launched it.

A process tree is the question an investigation asks first - *how did this get
here* - and until now Remora held every piece of the answer and would not
assemble it. Event logs carry process creation; the tree is what turns four
hundred thousand isolated events into a shape a person can read.

**Three sources, unequal, and the difference is recorded on every node.**

1. **Sysmon Event ID 1.** Authoritative. Carries a process GUID and its
   parent's, so lineage is asserted by the log itself and no inference is
   needed.
2. **Security 4688.** Carries parent *PID* and, only when audit policy captured
   it, the command line. PIDs are reused, so a link built from one is inferred
   rather than asserted.
3. **Amcache and prefetch.** Execution evidence with no lineage at all.
   Attached to a node as corroboration; never used to build an edge. That an
   executable ran is not a claim about who started it.

A node says which of the three it came from and whether its link to its parent
is `asserted` or `inferred`, because an analyst acting on a tree needs to know
which edges the data actually supports.

**Nothing is dropped.** A process whose parent is absent from the logs attaches
to a synthetic root rather than disappearing: a missing parent is itself a
finding, and usually the interesting one - it means the launcher was not
logged, which is either a gap in collection or the point of the intrusion.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

logger = logging.getLogger("remora.process_tree")

#: Sysmon writes these; the provider is checked as well because event id 1
#: means something else entirely on other channels.
SYSMON_PROVIDER = "microsoft-windows-sysmon"
SYSMON_CREATE   = 1
SYSMON_EXIT     = 5

#: Security channel equivalents. 4688 is process creation, 4689 its exit.
SECURITY_CREATE = 4688
SECURITY_EXIT   = 4689

EVENT_IDS = (SYSMON_CREATE, SYSMON_EXIT, SECURITY_CREATE, SECURITY_EXIT)

#: A ceiling on one case's tree. Beyond this the answer is a filtered query,
#: not a picture - and building the whole thing would hold a worker for
#: minutes to render something nobody can read.
MAX_PROCESSES = 20_000

#: How the parent link was established.
LINK_ASSERTED = "asserted"   # the log named the parent (Sysmon GUID)
LINK_INFERRED = "inferred"   # matched by PID within a lifetime window
LINK_ORPHAN   = "orphan"     # no parent found; attached to the synthetic root

ROOT_KEY = "__root__"


@dataclass
class Process:
    """One process, and how much of it is asserted rather than inferred."""
    key:          str
    pid:          int | None = None
    guid:         str | None = None
    image:        str = ""
    command_line: str = ""
    user:         str = ""
    integrity:    str = ""
    started:      datetime | None = None
    ended:        datetime | None = None
    parent_key:   str | None = None
    parent_pid:   int | None = None
    parent_guid:  str | None = None
    parent_image: str = ""
    link:         str = LINK_ORPHAN
    #: `sysmon:1`, `security:4688` - which records contributed to this node.
    sources:      list[str] = field(default_factory=list)
    #: Artifacts that agree this executable ran, without saying who started it.
    corroboration: list[str] = field(default_factory=list)
    computer:     str = ""

    def as_dict(self) -> dict:
        return {
            "key":           self.key,
            "pid":           self.pid,
            "guid":          self.guid,
            "image":         self.image,
            "name":          basename(self.image),
            "command_line":  self.command_line,
            "user":          self.user,
            "integrity":     self.integrity,
            "computer":      self.computer,
            "started":       self.started.isoformat() if self.started else None,
            "ended":         self.ended.isoformat() if self.ended else None,
            "parent_key":    self.parent_key,
            "parent_pid":    self.parent_pid,
            "parent_image":  self.parent_image,
            "parent_name":   basename(self.parent_image),
            "link":          self.link,
            "sources":       sorted(set(self.sources)),
            "corroboration": sorted(set(self.corroboration)),
        }


def basename(path: str) -> str:
    """`C:\\Windows\\System32\\cmd.exe` to `cmd.exe`, whatever the separator."""
    if not path:
        return ""
    return path.replace("/", "\\").rsplit("\\", 1)[-1]


def parse_pid(raw: Any) -> int | None:
    """
    A process id, decimal or hexadecimal.

    Security 4688 writes `0x1a2c`; Sysmon writes `6700`. Reading one as the
    other silently builds a tree out of processes that never existed, and
    nothing downstream would notice - the numbers are all plausible.
    """
    if raw is None:
        return None
    if isinstance(raw, int):
        return raw
    text = str(raw).strip()
    if not text:
        return None
    try:
        return int(text, 16) if text.lower().startswith("0x") else int(text)
    except ValueError:
        return None


def _get(data: dict, *names: str) -> str:
    """The first of `names` present in the event data, as text."""
    for name in names:
        value = data.get(name)
        if value not in (None, ""):
            return str(value)
    return ""


def _is_sysmon(event: SourceEvent) -> bool:
    return SYSMON_PROVIDER in event.provider.lower()


def _when(event: SourceEvent) -> datetime | None:
    return event.when


def _computer(event: SourceEvent) -> str:
    return event.computer


# ─── Reading the events ───────────────────────────────────────────────────────
# The tree used to read `evtx_events`, a table the Logs module filled by
# parsing EVTX a second time - the Artifact Explorer already held the same
# records, parsed once by EvtxECmd. Reading the store instead means the tree
# survives the Logs module being retired, and stops the product from holding
# two parses of one file that could disagree.


@dataclass
class SourceEvent:
    """
    One event, however it was parsed.

    A deliberately small shape. Everything below it - the linking, the PID
    reuse window, the provenance labels - works on `Process`, so the only
    thing a new source has to produce is this.
    """
    event_id: int
    provider: str
    computer: str
    when:     datetime | None
    data:     dict


#: Columns an EvtxECmd table always carries. Used to recognise one whatever
#: the file was called - a triage names event log tables after the channel,
#: after the host, or after nothing at all.
EVTX_MARKERS = ("EventId", "Payload")


def _payload_fields(payload: str) -> dict[str, str]:
    """
    Every named field inside an EvtxECmd `Payload`, whatever shape it took.

    EvtxECmd renders the event XML as JSON, and the shape varies with the
    event: `EventData.Data` is a list of `{"@Name": ..., "#text": ...}` for
    most, a single such object when there is one field, and some channels use
    `UserData` with plain keys instead.

    So this walks rather than indexes. A tolerant reader is the right trade
    here: the alternative is a tree that silently loses Sysmon lineage because
    one provider nested its fields differently.
    """
    try:
        root = json.loads(payload)
    except (ValueError, TypeError):
        return {}

    found: dict[str, str] = {}

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return

        name = node.get("@Name")
        if isinstance(name, str) and name:
            text = node.get("#text")
            found.setdefault(name, "" if text is None else str(text))

        for key, value in node.items():
            if key.startswith(("@", "#")):
                continue
            if isinstance(value, (dict, list)):
                walk(value)
            elif value is not None:
                found.setdefault(key, str(value))

    walk(root)
    return found


def _parse_time(raw: str) -> datetime | None:
    """
    A timestamp from a parsed table.

    The store has already converted the column to UTC when the artifact
    declares a source timezone, so what arrives here is UTC however it is
    punctuated. A row whose time does not parse keeps its place in the tree
    with no start time rather than being dropped - the process still ran.
    """
    value = (raw or "").strip().replace("Z", "").replace("T", " ")
    if not value:
        return None
    for shape in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(value, shape)
        except ValueError:
            continue
    return None


def _evtx_artifacts(db: Session, case_id: str) -> list:
    """Parsed event log tables in this case, recognised by their columns."""
    from ..models.csv_artifact import CsvArtifactFile

    out = []
    for row in db.query(CsvArtifactFile).filter(CsvArtifactFile.case_id == case_id).all():
        try:
            columns = json.loads(str(row.columns))
        except (ValueError, TypeError):
            continue
        if all(marker in columns for marker in EVTX_MARKERS):
            out.append((row, columns))
    return out


#: The four event ids, as RQL. Pushed down to the store rather than filtered
#: in Python for the same reason the SQL filter existed before: a case holds
#: hundreds of thousands of events and these are a small fraction of them.
_EVENT_FILTER = "EventId IN (" + ", ".join(f'"{i}"' for i in EVENT_IDS) + ")"


def _load_events(db: Session, case_id: str, limit: int) -> list[SourceEvent]:
    """
    Every process creation and exit in the case, oldest first.

    Read through `ArtifactStore`, so an artifact declaring a source timezone is
    normalised on the way in and two collections from different machines line
    up. An unreadable table is skipped rather than fatal: a tree built from
    three of four logs is worth more than an error.
    """
    from .store import Query, Source, SourceMissing, get_store

    store  = get_store()
    events: list[SourceEvent] = []

    for artifact, columns in _evtx_artifacts(db, case_id):
        source = Source(
            ref         = str(artifact.file_path),
            date_column = str(artifact.date_column) if artifact.date_column else None,
            timezone    = str(artifact.source_timezone) if artifact.source_timezone else None,
        )
        try:
            page = store.search(source, columns, Query(rql=_EVENT_FILTER),
                                page=1, page_size=limit)
        except SourceMissing:
            logger.warning("process tree: %s is registered but gone from disk",
                           artifact.original_name)
            continue
        except Exception as exc:                              # pragma: no cover
            logger.warning("process tree: could not read %s: %s",
                           artifact.original_name, exc)
            continue

        for row in page.rows:
            try:
                event_id = int(str(row.get("EventId") or "").strip())
            except ValueError:
                continue
            events.append(SourceEvent(
                event_id = event_id,
                provider = str(row.get("Provider") or ""),
                computer = str(row.get("Computer") or ""),
                when     = _parse_time(str(row.get("TimeCreated") or "")),
                data     = _payload_fields(str(row.get("Payload") or "")),
            ))

    # Sorted here rather than by the store: the events come from several
    # tables, and a tree assembled out of order attaches a child to whichever
    # candidate parent happened to be read first.
    events.sort(key=lambda e: (e.when is None, e.when or datetime.min))
    return events[:limit]


def _from_sysmon(event: SourceEvent, data: dict) -> Process:
    guid = _get(data, "ProcessGuid")
    pid = parse_pid(_get(data, "ProcessId"))
    return Process(
        key=guid or _pid_key(pid, _when(event)),
        pid=pid,
        guid=guid or None,
        image=_get(data, "Image"),
        command_line=_get(data, "CommandLine"),
        user=_get(data, "User"),
        integrity=_get(data, "IntegrityLevel"),
        started=_when(event),
        parent_guid=_get(data, "ParentProcessGuid") or None,
        parent_pid=parse_pid(_get(data, "ParentProcessId")),
        parent_image=_get(data, "ParentImage"),
        computer=_computer(event),
        sources=["sysmon:1"],
    )


def _from_security(event: SourceEvent, data: dict) -> Process:
    pid = parse_pid(_get(data, "NewProcessId"))
    return Process(
        key=_pid_key(pid, _when(event)),
        pid=pid,
        image=_get(data, "NewProcessName"),
        # Present only when the audit policy was configured to capture it,
        # which it usually is not. An empty command line here is the norm, not
        # a parsing failure.
        command_line=_get(data, "CommandLine"),
        user=_get(data, "SubjectUserName"),
        integrity=_get(data, "TokenElevationType"),
        started=_when(event),
        parent_pid=parse_pid(_get(data, "ProcessId")),
        parent_image=_get(data, "ParentProcessName"),
        computer=_computer(event),
        sources=["security:4688"],
    )


def _pid_key(pid: int | None, when: datetime | None) -> str:
    """
    Identity for a process the log did not give a GUID.

    A PID alone is not an identity - Windows reuses them, and on a busy machine
    within minutes. Pairing it with the creation time is what keeps two
    different processes that happened to share a number apart.
    """
    stamp = when.isoformat() if when else "?"
    return f"pid:{pid if pid is not None else '?'}@{stamp}"


# ─── Building the tree ────────────────────────────────────────────────────────

def build(db: Session, case_id: str, *, limit: int = MAX_PROCESSES,
          focus: Focus | None = None) -> dict:
    """
    The process tree for a case, with every edge labelled by how it was found.

    With a `focus`, the answer is narrowed to one process and its line: every
    ancestor up to the root, and everything it started. That is the shape the
    Artifact Explorer asks for - an analyst looking at one suspicious event
    wants the chain that produced it, not twenty thousand nodes to search.
    """
    events = _load_events(db, case_id, limit)

    processes: dict[str, Process] = {}
    by_guid: dict[str, Process] = {}
    by_pid: dict[int, list[Process]] = {}
    truncated = len(events) >= limit

    for event in events:
        data = event.data
        sysmon = _is_sysmon(event)

        if event.event_id == SYSMON_CREATE and sysmon:
            process = _from_sysmon(event, data)
        elif event.event_id == SECURITY_CREATE:
            process = _from_security(event, data)
        elif event.event_id in (SYSMON_EXIT, SECURITY_EXIT):
            _record_exit(event, data, sysmon, by_guid, by_pid)
            continue
        else:
            continue

        if process.key in processes:
            # The same creation seen twice - a log collected from two places,
            # or an EVTX imported again. Merge the sources rather than
            # producing two nodes for one process.
            processes[process.key].sources.extend(process.sources)
            continue

        processes[process.key] = process
        if process.guid:
            by_guid[process.guid] = process
        if process.pid is not None:
            by_pid.setdefault(process.pid, []).append(process)

    _link(processes, by_guid, by_pid)

    matched: Process | None = None
    if focus is not None:
        matched = _find(processes, focus)
        if matched is None:
            return _render({}, truncated, len(events), focus=focus, found=False)
        processes = _lineage(processes, matched)

    _corroborate(db, case_id, processes)

    return _render(processes, truncated, len(events),
                   focus=focus, found=focus is None or matched is not None,
                   focus_key=matched.key if matched else None)


# ─── Focusing on one process ──────────────────────────────────────────────────

@dataclass(frozen=True)
class Focus:
    """
    Which process the analyst is asking about.

    Identified the way the row they clicked identifies it, which is rarely a
    GUID: a Security 4688 carries a PID and a time and nothing else. So any of
    the three narrows, and together they are usually enough - `pid` alone on a
    busy machine is not, which is exactly why `at` exists.
    """
    guid: str | None = None
    pid:  int | None = None
    #: The event's own timestamp. The nearest process with this PID that was
    #: alive then wins, which is the same reasoning `_pid_key` encodes.
    at:   datetime | None = None
    #: Executable name, when the row carries one. Breaks a tie between two
    #: processes that shared a PID within the window.
    image: str | None = None


def _find(processes: dict[str, Process], focus: Focus) -> Process | None:
    """The process a focus names, or None."""
    if focus.guid:
        for process in processes.values():
            if process.guid == focus.guid:
                return process
        # A GUID that matches nothing is a miss, not a reason to fall back to
        # the PID: the two would answer about different processes.
        return None

    if focus.pid is None:
        return None

    candidates = [p for p in processes.values() if p.pid == focus.pid]
    if focus.image:
        wanted = basename(focus.image).lower()
        narrowed = [p for p in candidates if basename(p.image).lower() == wanted]
        candidates = narrowed or candidates
    if not candidates:
        return None
    if focus.at is None or len(candidates) == 1:
        return candidates[0]

    # Alive at that moment, preferring the one that had already started. A PID
    # is reused within minutes on a busy machine, so picking the first match
    # would attach the analyst to a different process with the same number.
    alive = [
        p for p in candidates
        if (p.started is None or p.started <= focus.at)
        and (p.ended is None or p.ended >= focus.at)
    ]
    pool = alive or candidates
    at = focus.at

    def distance(process: Process) -> float:
        started = process.started
        return abs((started - at).total_seconds()) if started else 0.0

    return min(pool, key=distance)


def _lineage(processes: dict[str, Process], target: Process) -> dict[str, Process]:
    """
    The target, everything that led to it, and everything it started.

    Both directions, because both answer the question. The ancestors say how
    it got there; the descendants say what it did. Cutting either leaves the
    analyst reading half a chain.
    """
    keep: dict[str, Process] = {target.key: target}

    walker = target
    while walker.parent_key and walker.parent_key != ROOT_KEY:
        parent = processes.get(walker.parent_key)
        if parent is None or parent.key in keep:
            break                                  # a cycle, or a missing link
        keep[parent.key] = parent
        walker = parent

    children: dict[str, list[Process]] = {}
    for process in processes.values():
        children.setdefault(process.parent_key or ROOT_KEY, []).append(process)

    queue = [target]
    while queue:
        current = queue.pop()
        for child in children.get(current.key, []):
            if child.key in keep:
                continue
            keep[child.key] = child
            queue.append(child)

    return keep


def _record_exit(event: SourceEvent, data: dict, sysmon: bool,
                 by_guid: dict[str, Process], by_pid: dict[int, list[Process]]) -> None:
    """
    Close a process's lifetime.

    This is what makes PID reuse resolvable at all. Without an end time every
    process with a given PID looks like a candidate parent forever, and the
    tree quietly attaches children to whichever one happened to be found first.
    """
    guid = _get(data, "ProcessGuid") if sysmon else ""
    if guid and guid in by_guid:
        by_guid[guid].ended = _when(event)
        return

    pid = parse_pid(_get(data, "ProcessId"))
    if pid is None:
        return
    when = _when(event)
    candidates = [p for p in by_pid.get(pid, [])
                  if p.ended is None
                  and (p.started is None or when is None or p.started <= when)]
    if candidates:
        candidates[-1].ended = when


#: How long after a parent's last seen activity a child may still claim it.
#: Only used when the parent has no recorded exit - which is the common case,
#: because 4689 is rarely enabled.
_REUSE_GRACE = timedelta(hours=12)


def _link(processes: dict[str, Process], by_guid: dict[str, Process],
          by_pid: dict[int, list[Process]]) -> None:
    """
    Attach each process to its parent, recording how the link was found.
    """
    for process in processes.values():
        # Asserted: Sysmon named the parent by GUID. No inference at all.
        if process.parent_guid and process.parent_guid in by_guid:
            asserted = by_guid[process.parent_guid]
            if asserted.key != process.key:
                process.parent_key = asserted.key
                process.link = LINK_ASSERTED
                continue

        inferred = _parent_by_pid(process, by_pid)
        if inferred is not None:
            process.parent_key = inferred.key
            process.link = LINK_INFERRED
            continue

        process.parent_key = ROOT_KEY
        process.link = LINK_ORPHAN


def _parent_by_pid(child: Process, by_pid: dict[int, list[Process]]) -> Process | None:
    """
    The process that held the parent PID when the child started.

    By time window, never by PID alone. Among the processes that carried that
    number, only one can have been alive at the moment the child was created:
    started before it, and either still running or exited after it. When
    several remain - because exits were not logged - the most recent start
    wins, which is the one Windows would have had.
    """
    if child.parent_pid is None or child.started is None:
        return None

    alive = []
    for candidate in by_pid.get(child.parent_pid, []):
        if candidate.key == child.key or candidate.started is None:
            continue
        if candidate.started > child.started:
            continue
        if candidate.ended is not None:
            if candidate.ended < child.started:
                continue
        elif child.started - candidate.started > _REUSE_GRACE:
            # No exit recorded and the gap is implausible. Refusing here is
            # what stops a boot-time service adopting everything that ran on
            # the machine that week.
            continue
        alive.append(candidate)

    if not alive:
        return None
    return max(alive, key=lambda p: p.started or datetime.min)


# ─── Corroboration ────────────────────────────────────────────────────────────

def _corroborate(db: Session, case_id: str, processes: dict[str, Process]) -> None:
    """
    Mark nodes whose executable also appears in execution evidence.

    Amcache and prefetch say an executable ran; they say nothing about who
    started it, so they never create an edge. What they add is confidence in a
    node that came from a single 4688 with no command line.

    Read once per artifact type and matched on the executable name, rather than
    a lookup per node. A tree of twenty thousand nodes against two tables is
    two queries either way; per node it would be forty thousand.
    """
    wanted = {basename(p.image).lower() for p in processes.values() if p.image}
    if not wanted:
        return

    for label, names in _execution_evidence(db, case_id).items():
        overlap = wanted & names
        if not overlap:
            continue
        for process in processes.values():
            if basename(process.image).lower() in overlap:
                process.corroboration.append(label)


def _execution_evidence(db: Session, case_id: str) -> dict[str, set[str]]:
    """
    Executable names seen in prefetch and Amcache tables for this case.

    Reads the artifacts through the store, which is the only thing that knows
    where a parsed table lives. A missing or unreadable table is not an error:
    corroboration is an enrichment, and a tree without it is still a tree.
    """
    from ..models.csv_artifact import CsvArtifactFile
    from .store import Query, get_store

    #: Artifact name to the column holding an executable name.
    tables = {
        "prefetch.csv":     ("Prefetch", "ExecutableName"),
        "amcache":          ("Amcache", "Name"),
    }

    found: dict[str, set[str]] = {}
    rows = db.query(CsvArtifactFile).filter(CsvArtifactFile.case_id == case_id).all()

    for artifact in rows:
        name = str(artifact.original_name or "").lower()
        match = next((v for k, v in tables.items() if k in name), None)
        if match is None:
            continue
        label, column = match
        try:
            columns = json.loads(str(artifact.columns))
            if column not in columns:
                continue
            groups = get_store().aggregate(
                str(artifact.file_path), columns, Query(), [column])
        except Exception as e:
            logger.debug("no corroboration from %s: %s", artifact.original_name, e)
            continue
        found.setdefault(label, set()).update(
            basename(str(g.values.get(column, ""))).lower()
            for g in groups if g.values.get(column)
        )

    return found


# ─── Shaping the answer ───────────────────────────────────────────────────────

def _render(processes: dict[str, Process], truncated: bool, events: int, *,
            focus: Focus | None = None, found: bool = True,
            focus_key: str | None = None) -> dict:
    """The tree as the API returns it, with the counts that qualify it."""
    nodes = [p.as_dict() for p in processes.values()]
    nodes.sort(key=lambda n: (n["started"] or "", n["name"]))

    links = [n["link"] for n in nodes]
    return {
        "root": ROOT_KEY,
        "nodes": nodes,
        # Which node the analyst asked about, so the view can mark it. Absent
        # for a whole-case tree, and explicitly `found: false` when a focus
        # matched nothing - an empty tree and "that process is not in these
        # logs" are different answers.
        "focus": {
            "requested": bool(focus),
            "found":     found,
            "key":       focus_key,
        },
        "stats": {
            "processes":  len(nodes),
            "events":     events,
            "asserted":   links.count(LINK_ASSERTED),
            "inferred":   links.count(LINK_INFERRED),
            "orphans":    links.count(LINK_ORPHAN),
            "from_sysmon":   sum(1 for n in nodes if "sysmon:1" in n["sources"]),
            "from_security": sum(1 for n in nodes if "security:4688" in n["sources"]),
            "corroborated":  sum(1 for n in nodes if n["corroboration"]),
            # Said rather than hidden. A truncated tree that looks complete is
            # a tree an analyst draws conclusions from.
            "truncated":  truncated,
        },
    }
