# Charybdis agent definitions

Analyst-authored, like case templates. Loaded and validated by
`backend/app/services/charybdis/definitions.py`; an invalid file stops the
module from starting rather than producing an agent that behaves unpredictably.

- `roles/*.yaml` - who an agent is: its prompt, its tools, its processes, its budget.
- `processes/*.yaml` - the steps it goes through. A step ends when the model
  answers without calling a tool; that answer is the step's summary, and the
  last step's summary is the task report.
- `prompts/*.md` - role prompts. `_rules.md` is appended to every one.

A role with `assignable: true` can be given tasks by the Incident Leader;
the leader, the assistant and the reviewer get their work another way.

- `teams.yaml` - which team "Staff team" puts on a case, by its tags and description.
- `bench/*.yaml` - golden cases for the evaluation bench: a case description, a role and
  objective, the evidence in `bench/data/`, and what a good run must produce.

Tool names must exist in `services/charybdis/tools.py` (`GET /api/v1/agents/tools`).
`"@role"` in a step means every tool of the role.
