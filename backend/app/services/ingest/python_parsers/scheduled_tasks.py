"""
Windows scheduled tasks.

No Eric Zimmerman tool reads these, and nothing else in the pipeline did
either: all 272 in the reference triage were unidentified. That is the worst
gap the coverage measurement turned up, because a scheduled task is where
persistence lives. An attacker who wants to survive a reboot writes one, and
Remora could not see it.

The artifact is a UTF-16 XML document under `Windows\\System32\\Tasks`, usually
with no extension at all - which is why identification matches the Task schema
in the content rather than anything about the name (`services/ingest/identify.py`).

**One row per action, not per task.** A task can run several commands and the
question an analyst asks is "what runs?", so the command has to be the thing
being filtered on. Task-level fields repeat across a task's rows, which is the
same trade the other tables here make.
"""
from __future__ import annotations

import csv
import logging
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree.ElementTree import Element

from defusedxml import ElementTree

logger = logging.getLogger("remora.python_parsers.scheduled_tasks")


def _tag(element: Element) -> str:
    """The local name, with the schema namespace stripped."""
    return element.tag.rpartition("}")[2]


def _find(parent: Element | None, name: str) -> Element | None:
    if parent is None:
        return None
    for child in parent:
        if _tag(child) == name:
            return child
    return None


def _text(parent: Element | None, name: str) -> str:
    child = _find(parent, name)
    return (child.text or "").strip() if child is not None and child.text else ""


def _path(root: Element, *names: str) -> Element | None:
    node: Element | None = root
    for name in names:
        node = _find(node, name)
        if node is None:
            return None
    return node


@dataclass
class Action:
    kind:      str = ""
    command:   str = ""
    arguments: str = ""
    directory: str = ""


@dataclass
class Task:
    source:      str = ""
    name:        str = ""
    uri:         str = ""
    enabled:     str = ""
    hidden:      str = ""
    author:      str = ""
    description: str = ""
    registered:  str = ""
    run_as:      str = ""
    run_level:   str = ""
    logon_type:  str = ""
    triggers:    list[str] = field(default_factory=list)
    actions:     list[Action] = field(default_factory=list)


def _describe_trigger(element: Element) -> str:
    """
    A trigger as one readable string.

    Summarised rather than exploded into columns: the nine trigger types in the
    reference triage have almost nothing in common structurally, and a table
    wide enough for all of them would be mostly empty. What an analyst needs
    from this column is *when*, and whether it is enabled.
    """
    kind = _tag(element)
    parts = [kind]

    start = _text(element, "StartBoundary")
    if start:
        parts.append(f"from {start}")

    repetition = _find(element, "Repetition")
    interval = _text(repetition, "Interval") if repetition is not None else ""
    if interval:
        parts.append(f"every {interval}")

    # An `Enabled` of `false` is worth seeing: a disabled trigger on an
    # otherwise live task is a very different fact from an active one.
    if _text(element, "Enabled").lower() == "false":
        parts.append("(disabled)")

    subscription = _text(element, "Subscription")
    if subscription:
        parts.append(f"on event {subscription[:120]}")

    return " ".join(parts)


def _read_action(element: Element) -> Action:
    kind = _tag(element)
    if kind == "Exec":
        return Action(kind, _text(element, "Command"),
                      _text(element, "Arguments"),
                      _text(element, "WorkingDirectory"))
    if kind == "ComHandler":
        # A COM handler names a CLSID rather than an executable. Recorded as
        # the command, because it *is* what runs - resolving the CLSID to a DLL
        # needs the SOFTWARE hive, which the Registry Explorer now opens.
        return Action(kind, _text(element, "ClassId"), _text(element, "Data"))
    return Action(kind)


def parse(path: Path, base: Path | None = None) -> Task:
    """Read one task definition. Raises on XML that will not parse."""
    root = ElementTree.fromstring(path.read_bytes())

    task = Task(source=_relative(path, base))
    registration = _find(root, "RegistrationInfo")
    settings     = _find(root, "Settings")
    principal    = _path(root, "Principals", "Principal")

    task.uri         = _text(registration, "URI")
    task.name        = task.uri.rpartition("\\")[2] or path.name
    task.author      = _text(registration, "Author")
    task.description = _text(registration, "Description")
    task.registered  = _text(registration, "Date")
    task.enabled     = _text(settings, "Enabled") or "true"
    task.hidden      = _text(settings, "Hidden") or "false"

    if principal is not None:
        task.run_as     = _text(principal, "UserId") or _text(principal, "GroupId")
        task.run_level  = _text(principal, "RunLevel")
        task.logon_type = _text(principal, "LogonType")

    triggers = _find(root, "Triggers")
    if triggers is not None:
        task.triggers = [_describe_trigger(child) for child in triggers]

    actions = _find(root, "Actions")
    if actions is not None:
        task.actions = [_read_action(child) for child in actions]

    return task


def _relative(path: Path, base: Path | None) -> str:
    if base is None:
        return path.name
    try:
        return str(path.relative_to(base))
    except ValueError:
        return path.name


COLUMNS = [
    "SourceFile", "TaskName", "TaskPath", "Enabled", "Hidden",
    "RunAs", "RunLevel", "LogonType",
    "ActionType", "Command", "Arguments", "WorkingDirectory",
    "TriggerCount", "Triggers",
    "Author", "Description", "RegisteredDate",
]

ERROR_COLUMNS = ["SourceFile", "Error"]


def _rows(task: Task) -> list[list[str]]:
    triggers = "; ".join(task.triggers)
    head = [task.source, task.name, task.uri, task.enabled, task.hidden,
            task.run_as, task.run_level, task.logon_type]
    tail = [str(len(task.triggers)), triggers,
            task.author, task.description, task.registered]

    if not task.actions:
        # A task with no action still matters: it is a registration, and its
        # triggers and principal are facts about the machine.
        return [head + ["", "", "", ""] + tail]

    return [
        head + [a.kind, a.command, a.arguments, a.directory] + tail
        for a in task.actions
    ]


def write_csv(tasks: list[Task], errors: dict[str, str], out_dir: Path) -> list[Path]:
    """One table for the collection, plus a second naming what would not parse."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    if tasks:
        target = out_dir / "scheduled_tasks.csv"
        with target.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(COLUMNS)
            for task in tasks:
                writer.writerows(_rows(task))
        written.append(target)

    if errors:
        # Recorded in the output rather than only logged. A task that would not
        # parse is a task nobody is looking at, and a silent omission from a
        # persistence table is the wrong kind of quiet.
        target = out_dir / "scheduled_tasks_errors.csv"
        with target.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(ERROR_COLUMNS)
            writer.writerows(sorted(errors.items()))
        written.append(target)

    return written


def parse_all(paths: list[Path], out_dir: Path, base: Path | None = None) -> list[Path]:
    """Every task in a collection, into one table."""
    parsed: list[Task] = []
    errors: dict[str, str] = {}
    for path in paths:
        try:
            parsed.append(parse(path, base))
        except Exception as e:
            errors[_relative(path, base)] = f"{type(e).__name__}: {e}"
            logger.warning("could not read task %s: %s", path.name, e)
    return write_csv(parsed, errors, out_dir)
