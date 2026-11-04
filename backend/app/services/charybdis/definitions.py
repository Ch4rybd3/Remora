"""
Roles and processes, loaded from `templates/agents/`.

Analyst-authored YAML, validated here once: every tool a role names must
exist, every process it names must exist, every step's tools must be the
role's. A definition that fails validation stops the module rather than
producing an agent whose behaviour nobody wrote down.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, ValidationError, field_validator

from ...config import settings
from ...models.case import Case
from .tools import TOOLS

ROLE_TOOLS = "@role"
DEFAULT_ROLE = "assistant"
LEADER_ROLE = "incident-leader"
REVIEWER_ROLE = "reviewer"


class DefinitionError(Exception):
    """A role or process file is invalid. The message names the file."""


class StepDef(BaseModel):
    id:           str = Field(..., pattern=r"^[a-z][a-z0-9_-]*$")
    instructions: str
    tools:        list[str] | Literal["@role"] = "@role"
    #: The step's work is its tool calls (proposing, giving a verdict). An
    #: answer in text alone gets one reminder before the step ends: small
    #: models write "Proposed findings:" and never call the tool.
    expects_tools: bool = False


class ProcessDef(BaseModel):
    id:          str = Field(..., pattern=r"^[a-z][a-z0-9_-]*$")
    description: str = ""
    steps:       list[StepDef] = Field(..., min_length=1)

    def step(self, step_id: str | None) -> tuple[int, StepDef]:
        for index, step in enumerate(self.steps):
            if step.id == step_id:
                return index, step
        return 0, self.steps[0]


class RoleDef(BaseModel):
    id:                   str = Field(..., pattern=r"^[a-z][a-z0-9_-]*$")
    name:                 str
    description:          str = ""
    reports_to:           str | None = None
    prompt:               str
    #: Followed when the analyst talks to the agent directly.
    conversation_process: str = "conversation"
    #: Followed for work assigned to the agent (delegated, reports, help).
    process:              str = "conversation"
    max_steps:            int = Field(12, ge=1, le=100)
    #: Whether the leader may propose tasks for this role. The leader, the
    #: assistant and the reviewer get their work another way.
    assignable:           bool = False
    #: Give the role, at the start of every task, the lessons of earlier
    #: cases that match this one. A real run showed a leader asked to cite
    #: lessons inventing them rather than searching.
    recall_lessons:       bool = False
    tools:                list[str] = Field(default_factory=list)
    #: Filled from `prompt` at load time.
    prompt_text:          str = ""

    @field_validator("tools")
    @classmethod
    def _known_tools(cls, tools: list[str]) -> list[str]:
        unknown = sorted(set(tools) - set(TOOLS))
        if unknown:
            raise ValueError(f"unknown tools {unknown}")
        return tools

    def step_tools(self, step: StepDef) -> list[str]:
        return list(self.tools) if step.tools == ROLE_TOOLS else list(step.tools)


class TeamMatch(BaseModel):
    tags:     list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)


class TeamDef(BaseModel):
    """A team staffed for a kind of incident, chosen from what the case says it is."""
    id:    str = Field(..., pattern=r"^[a-z][a-z0-9_-]*$")
    name:  str
    match: TeamMatch | None = None
    roles: list[str] = Field(..., min_length=1)

    def fits(self, tags: set[str], text: str) -> bool:
        if self.match is None:
            return True
        return bool(tags & {t.lower() for t in self.match.tags}) or any(
            k.lower() in text for k in self.match.keywords)


class Definitions(BaseModel):
    roles:     dict[str, RoleDef]
    processes: dict[str, ProcessDef]
    rules:     str
    teams:     list[TeamDef] = Field(default_factory=list)

    def team_for(self, case: Case) -> TeamDef | None:
        """The first team whose rule matches the case's tags, title or description."""
        tags = {t.strip().lower() for t in str(case.tags or "").split(",") if t.strip()}
        text = f"{case.title} {case.description or ''}".lower()
        return next((team for team in self.teams if team.fits(tags, text)), None)

    def role(self, role_id: str) -> RoleDef:
        return self.roles.get(role_id) or self.roles[DEFAULT_ROLE]

    def process_for(self, role: RoleDef, assigned: bool) -> ProcessDef:
        return self.processes[role.process if assigned else role.conversation_process]


def _load_yaml(path: Path) -> dict:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise DefinitionError(f"{path.name}: not valid YAML ({exc})") from exc
    if not isinstance(data, dict):
        raise DefinitionError(f"{path.name}: expected a mapping at the top level")
    return data


#: (kind, name) -> text: definitions written in the interface, over the files.
Overrides = dict[tuple[str, str], str]


def _parse_yaml(label: str, text: str) -> dict[str, Any]:
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise DefinitionError(f"{label}: not valid YAML ({exc})") from exc
    if not isinstance(data, dict):
        raise DefinitionError(f"{label}: expected a mapping at the top level")
    return data


def sources(root: Path, overrides: Overrides | None = None) -> dict[tuple[str, str], tuple[str, str]]:
    """
    Every definition as (kind, name) -> (text, origin), origin being builtin
    (a file), modified (a file replaced in the interface) or custom (new).
    """
    found: dict[tuple[str, str], tuple[str, str]] = {}
    for kind, folder, pattern in (("process", "processes", "*.yaml"), ("role", "roles", "*.yaml"),
                                  ("prompt", "prompts", "*.md")):
        for path in sorted((root / folder).glob(pattern)):
            text = path.read_text(encoding="utf-8")
            name = path.name if kind == "prompt" else str(
                _parse_yaml(f"{folder}/{path.name}", text).get("id") or path.stem)
            found[(kind, name)] = (text, "builtin")
    for key, text in (overrides or {}).items():
        found[key] = (text, "modified" if key in found else "custom")
    return found


def load(root: Path, overrides: Overrides | None = None) -> Definitions:
    """Read and cross-check every definition under `root`, with `overrides` over them. Raises DefinitionError."""
    every = sources(root, overrides)
    labels = {"process": "processes", "role": "roles", "prompt": "prompts"}

    def label(kind: str, name: str) -> str:
        origin = every[(kind, name)][1]
        where = f"{labels[kind]}/{name}" + ("" if kind == "prompt" else ".yaml")
        return where if origin == "builtin" else f"{where} (edited)"

    processes: dict[str, ProcessDef] = {}
    for (kind, name), (text, _) in every.items():
        if kind != "process":
            continue
        try:
            process = ProcessDef.model_validate(_parse_yaml(label(kind, name), text))
        except ValidationError as exc:
            raise DefinitionError(f"{label(kind, name)}: {exc}") from exc
        if process.id != name:
            raise DefinitionError(f"{label(kind, name)}: its id is '{process.id}', not '{name}'")
        processes[process.id] = process

    roles: dict[str, RoleDef] = {}
    for (kind, name), (text, _) in sorted(every.items()):
        if kind != "role":
            continue
        where = label(kind, name)
        try:
            role = RoleDef.model_validate(_parse_yaml(where, text))
        except ValidationError as exc:
            raise DefinitionError(f"{where}: {exc}") from exc
        if role.id != name:
            raise DefinitionError(f"{where}: its id is '{role.id}', not '{name}'")
        prompt = every.get(("prompt", role.prompt))
        if prompt is None:
            raise DefinitionError(f"{where}: prompt {role.prompt} not found")
        role.prompt_text = prompt[0].strip()
        for process_id in (role.process, role.conversation_process):
            if process_id not in processes:
                raise DefinitionError(f"{where}: process '{process_id}' not found")
            for step in processes[process_id].steps:
                stray = sorted(set(role.step_tools(step)) - set(role.tools))
                if stray:
                    raise DefinitionError(
                        f"{where}: step '{process_id}.{step.id}' uses tools "
                        f"the role does not hold: {stray}")
        roles[role.id] = role

    if DEFAULT_ROLE not in roles:
        raise DefinitionError(f"the '{DEFAULT_ROLE}' role is required")
    for role in roles.values():
        if role.reports_to and role.reports_to not in roles:
            raise DefinitionError(f"roles/{role.id}.yaml: reports_to '{role.reports_to}' not found")

    rules_source = every.get(("prompt", "_rules.md"))
    rules = rules_source[0].strip() if rules_source else ""

    teams: list[TeamDef] = []
    teams_path = root / "teams.yaml"
    if teams_path.is_file():
        try:
            teams = [TeamDef.model_validate(t) for t in _load_yaml(teams_path).get("teams") or []]
        except ValidationError as exc:
            raise DefinitionError(f"teams.yaml: {exc}") from exc
        for team in teams:
            unknown = sorted(set(team.roles) - set(roles))
            if unknown:
                raise DefinitionError(f"teams.yaml: team '{team.id}' names unknown roles {unknown}")
    return Definitions(roles=roles, processes=processes, rules=rules, teams=teams)


def stored_overrides() -> Overrides:
    """The definitions written in the interface. None before the table exists."""
    from sqlalchemy.exc import SQLAlchemyError

    from ...database import SessionLocal
    from ...models.agent import AgentDefinitionOverride

    db = SessionLocal()
    try:
        return {(o.kind, o.name): o.content for o in db.query(AgentDefinitionOverride)}
    except SQLAlchemyError:
        return {}
    finally:
        db.close()


@lru_cache(maxsize=1)
def definitions() -> Definitions:
    """
    The files, with the interface's edits over them. An edit that no longer
    validates against the files (after an upgrade) is set aside rather than
    stopping every agent: the files alone still load.
    """
    import logging

    root = settings.templates_path / "agents"
    overrides = stored_overrides()
    if not overrides:
        return load(root)
    try:
        return load(root, overrides)
    except DefinitionError as exc:
        logging.getLogger(__name__).error("Edited agent definitions set aside: %s", exc)
        return load(root)


def reload() -> None:
    """Read the definitions again: after an edit in the interface."""
    definitions.cache_clear()


def system_prompt(role: RoleDef, case: Case) -> str:
    from .phases import brief as phase_brief

    return (
        f"{role.prompt_text}\n\n"
        f"Case: {case.title}\n"
        f"TLP: {case.tlp or 'unlabelled'}\n"
        f"{phase_brief(getattr(case, 'phase', None))}\n\n"
        f"{definitions().rules}"
    )
