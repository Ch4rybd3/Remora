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
from typing import Literal

import yaml
from pydantic import BaseModel, Field, ValidationError, field_validator

from ...config import settings
from ...models.case import Case
from .tools import TOOLS

ROLE_TOOLS = "@role"
DEFAULT_ROLE = "assistant"
LEADER_ROLE = "incident-leader"


class DefinitionError(Exception):
    """A role or process file is invalid. The message names the file."""


class StepDef(BaseModel):
    id:           str = Field(..., pattern=r"^[a-z][a-z0-9_-]*$")
    instructions: str
    tools:        list[str] | Literal["@role"] = "@role"


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


class Definitions(BaseModel):
    roles:     dict[str, RoleDef]
    processes: dict[str, ProcessDef]
    rules:     str

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


def load(root: Path) -> Definitions:
    """Read and cross-check every definition under `root`. Raises DefinitionError."""
    processes: dict[str, ProcessDef] = {}
    for path in sorted((root / "processes").glob("*.yaml")):
        try:
            process = ProcessDef.model_validate(_load_yaml(path))
        except ValidationError as exc:
            raise DefinitionError(f"processes/{path.name}: {exc}") from exc
        processes[process.id] = process

    roles: dict[str, RoleDef] = {}
    for path in sorted((root / "roles").glob("*.yaml")):
        try:
            role = RoleDef.model_validate(_load_yaml(path))
        except ValidationError as exc:
            raise DefinitionError(f"roles/{path.name}: {exc}") from exc
        prompt = root / "prompts" / role.prompt
        if not prompt.is_file():
            raise DefinitionError(f"roles/{path.name}: prompt {role.prompt} not found")
        role.prompt_text = prompt.read_text(encoding="utf-8").strip()
        for process_id in (role.process, role.conversation_process):
            if process_id not in processes:
                raise DefinitionError(f"roles/{path.name}: process '{process_id}' not found")
            for step in processes[process_id].steps:
                stray = sorted(set(role.step_tools(step)) - set(role.tools))
                if stray:
                    raise DefinitionError(
                        f"roles/{path.name}: step '{process_id}.{step.id}' uses tools "
                        f"the role does not hold: {stray}")
        roles[role.id] = role

    if DEFAULT_ROLE not in roles:
        raise DefinitionError(f"the '{DEFAULT_ROLE}' role is required")
    for role in roles.values():
        if role.reports_to and role.reports_to not in roles:
            raise DefinitionError(f"roles/{role.id}.yaml: reports_to '{role.reports_to}' not found")

    rules_path = root / "prompts" / "_rules.md"
    rules = rules_path.read_text(encoding="utf-8").strip() if rules_path.is_file() else ""
    return Definitions(roles=roles, processes=processes, rules=rules)


@lru_cache(maxsize=1)
def definitions() -> Definitions:
    return load(settings.templates_path / "agents")


def system_prompt(role: RoleDef, case: Case) -> str:
    return (
        f"{role.prompt_text}\n\n"
        f"Case: {case.title}\n"
        f"TLP: {case.tlp or 'unlabelled'}\n\n"
        f"{definitions().rules}"
    )
