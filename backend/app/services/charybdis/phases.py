"""
Phases of an incident response (`docs/CHARYBDIS_FEATURES.md`, B5).

The ids are fixed - identification, containment, eradication, recovery,
lessons - and stored on the case; their names, goals and questions come from
`templates/agents/phases.yaml`, so a team can phrase them its own way.
"""
from __future__ import annotations

from functools import lru_cache

import yaml
from pydantic import BaseModel, Field

from ...config import settings

PHASE_IDS = ("identification", "containment", "eradication", "recovery", "lessons")
DEFAULT_PHASE = PHASE_IDS[0]


class PhaseDef(BaseModel):
    id:        str
    name:      str
    goal:      str
    questions: list[str] = Field(default_factory=list)


@lru_cache(maxsize=1)
def phases() -> list[PhaseDef]:
    """The phases in order. A phase missing from the file gets its id as name, so none is ever lost."""
    path = settings.templates_path / "agents" / "phases.yaml"
    found: dict[str, PhaseDef] = {}
    if path.is_file():
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        for raw in data.get("phases") or []:
            phase = PhaseDef.model_validate(raw)
            if phase.id not in PHASE_IDS:
                raise ValueError(f"phases.yaml: unknown phase '{phase.id}', expected one of {PHASE_IDS}")
            found[phase.id] = phase
    return [found.get(pid) or PhaseDef(id=pid, name=pid.capitalize(), goal="") for pid in PHASE_IDS]


def phase(phase_id: str | None) -> PhaseDef:
    return next((p for p in phases() if p.id == phase_id), phases()[0])


def brief(phase_id: str | None) -> str:
    """What every agent is told about the phase, in its system prompt."""
    current = phase(phase_id)
    questions = "\n".join(f"- {q}" for q in current.questions)
    return (f"Phase: {current.name}. Goal: {current.goal}\n"
            f"Questions this phase must answer:\n{questions}" if questions else
            f"Phase: {current.name}. Goal: {current.goal}")
