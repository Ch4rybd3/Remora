# Charybdis — Feature catalogue and arrival plan

Companion to [CHARYBDIS.md](CHARYBDIS.md). Every feature has an id, the sprint
it is planned for, what it depends on, and the Remora pieces it builds on.
Sprint numbers are provisional: per `CONVENTIONS.md`, a sprint is numbered from
the repository when it starts, not from this plan.

Legend — **Core**: the module is not usable without it. **Plus**: clear value,
planned. **Idea**: worth keeping, not scheduled.

---

## 1. Arrival plan

```
S30 FOUNDATIONS ── S31 LEADER & DELEGATION ── S32 FINDINGS & REVIEW ── S33 SPECIALISTS & TRIGGERS
                                                      │
                                                      └── S34 PROVIDERS & GOVERNANCE ── S35 OPENNESS & KNOWLEDGE
                                                                                             │
                                                                                     Backlog (Ideas)
```

| Sprint | Theme | Exit criterion (demo) |
|---|---|---|
| **S30** | Foundations | With the flag on, an analyst chats with one agent in a case's Team tab; it calls `case_overview` and `store_search`, and every turn and tool call streams live and survives a restart. |
| **S31** | Incident Leader and delegation | On a sample case, the leader runs the scoping interview, creates two tasks, a Windows analyst works them through its YAML process and its IOC and timeline proposals land in the inbox. |
| **S32** | Findings and review | Findings cite observations that open the exact Explorer row; the reviewer rejects one with a reason; the reporter drafts two report sections from validated findings only. |
| **S33** | Specialists and triggers | Dropping a memory dump into the case folder makes the leader propose a memory task without anyone asking; email, binary, network and timeline analysts are available. |
| **S34** | Providers and governance | A TLP:RED case refuses a cloud model with an audited denial; a TLP:GREEN case uses one with token cost shown per agent; the evaluation bench compares two local models. |
| **S35** | Openness and knowledge | Claude Code, through the MCP server, lists a case's findings with the same permissions as the analyst; the leader cites a lesson from a closed case. |

---

## 2. Catalogue

### A. Team and orchestration

| Id | Feature | Level | Sprint | Depends on | Builds on |
|---|---|---|---|---|---|
| A1 | **Agent instances per case**: add, remove, rename, choose model; live status | Core | S30 | — | Case, permissions |
| A2 | **Live org chart** with state colours, current task, budget used | Core | S30 | A1 | Shared ReactFlow components |
| A3 | **Live trace**: every thought, tool call, result and message, filterable, replayable | Core | S30 | A1 | Case WebSocket |
| A4 | **YAML roles and processes** under `templates/agents/`, validated at load | Core | S31 | A1 | Case template loader pattern |
| A5 | **Task board** (to do, in progress, in review, done, blocked) with dependencies | Core | S31 | A4 | DataTable, Panel |
| A6 | **Hub-and-spoke messaging** and help requests routed via the leader | Core | S31 | A4 | — |
| A7 | **Budgets** (steps, tokens, minutes) with escalation on overrun | Core | S31 | A3 | — |
| A8 | **Team templates**: a case template names the team to staff on creation (ransomware → leader, two Windows, memory, timeline, reporter) | Plus | S33 | A4 | Case templates (`ttp_definitions` precedent) |
| A9 | **Process and role editor** in the UI, with YAML view like templates | Plus | S35 | A4 | Templates page |
| A10 | **Pause, resume, take over**: the analyst steps into a task mid-process, then hands it back | Plus | S32 | A5 | — |
| A11 | **Playbook steps assignable to agents**: a Remora playbook step can name an agent role as assignee | Plus | S33 | A5 | Playbooks |

### B. Incident leadership

| Id | Feature | Level | Sprint | Depends on | Builds on |
|---|---|---|---|---|---|
| B1 | **Scoping interview**: what, when, who detected, critical assets, actions already taken; answers proposed into case description and assets | Core | S31 | A4 | Case, assets |
| B2 | **Investigation plan**: hypotheses → tasks → assignment, shown as a card the analyst approves | Core | S31 | B1 | — |
| B3 | **Situation report on demand** ("where are we?"): confirmed, open, blocked, next | Core | S31 | B2 | — |
| B4 | **Coverage gap analysis**: which artifacts are missing to answer each hypothesis, turned into a **collection request list** per host | Plus | S33 | B2 | `COVERAGE.md`, coverage router |
| B5 | **Phase tracking** (identification → containment → eradication → recovery → lessons) with phase-appropriate questions | Plus | S33 | B2 | Case status |
| B6 | **Shift handover brief**: what changed since a given time, for the next analyst on shift | Plus | S34 | A3 | Incident log |
| B7 | **Containment and remediation recommendations**, drafted, never executed | Plus | S34 | C3 | — |

### C. Analysis

| Id | Feature | Level | Sprint | Depends on | Builds on |
|---|---|---|---|---|---|
| C1 | **Read-only case tools**: overview, ingest status, store search, aggregate, find, schema | Core | S30 | — | ArtifactStore, RQL |
| C2 | **Windows host analyst**: EVTX, Chainsaw, registry, process tree, EZ outputs | Core | S31 | C1 | EZ parsers, sandbox |
| C3 | **Observations with exact pointers** (file, record id, row key, tool version) | Core | S32 | C1 | `ingested_files` |
| C4 | **Memory analyst** (Volatility plugin chains) | Plus | S33 | C3 | Memory analysis |
| C5 | **Network analyst** (hosts, flows, beaconing heuristics, DNS) | Plus | S33 | C3 | PCAP services |
| C6 | **Email analyst** (headers, links, attachments, phishing verdict) | Plus | S33 | C3 | Email analysis |
| C7 | **Binary analyst** (static triage, strings, imports, YARA) | Plus | S33 | C3 | Binary analysis |
| C8 | **Timeline analyst**: chains events across sources, proposes key pins and attack-graph edges | Plus | S33 | C3 | Timeline, attack graph |
| C9 | **Natural language → RQL**: the analyst asks in words, the agent shows the RQL it would run, the analyst runs or edits it | Plus | S32 | C1 | RQL parser |
| C10 | **"Ask an agent" from anywhere**: on an Explorer row, a timeline event, an IOC → explain, pivot, assess | Plus | S32 | C1 | Explorer `SidePanel` |
| C11 | **Ingestion triggers**: an artifact reaching `indexed` notifies the leader, which proposes the matching task | Plus | S33 | B2 | Ingest state machine |
| C12 | **Cross-case correlation**: IOCs and hashes seen in other cases, within the analyst's client scope | Plus | S35 | C3 | IOCs, client scoping |
| C13 | **Beyond Windows** analysts (Linux, macOS, mobile) as the platform grows | Idea | — | C3 | `PLATFORMS.md` |

### D. Findings, review and evidence

| Id | Feature | Level | Sprint | Depends on | Builds on |
|---|---|---|---|---|---|
| D1 | **Findings with mandatory evidence**, severity, confidence + justification, ATT&CK ids | Core | S32 | C3 | MITRE |
| D2 | **Analyst validation** (validate, reject with comment sent back to the author) | Core | S32 | D1 | — |
| D3 | **Reviewer agent**: does the cited evidence say what the finding claims? alternative explanations | Core | S32 | D1 | — |
| D4 | **Hypothesis board with competing-hypotheses matrix** (evidence for and against each) | Plus | S32 | D1 | — |
| D5 | **Clickable citations**: a citation opens the exact row in the Explorer side panel | Core | S32 | C3 | Explorer |
| D6 | **Tamper-evident trace**: `agent_events` chained by hash, verifiable and exportable | Plus | S32 | A3 | Audit |
| D7 | **Evidence strength scoring**: one weak source vs several independent corroborating sources | Idea | — | D1 | — |

### E. Proposals into Remora objects

| Id | Feature | Level | Sprint | Depends on | Builds on |
|---|---|---|---|---|---|
| E1 | **Proposals inbox**: accept, edit-then-accept, reject; accepted proposals go through the normal service and audit | Core | S31 | A3 | `audit_log` |
| E2 | IOC proposals, deduplicated against existing IOCs | Core | S31 | E1 | IOCs |
| E3 | Timeline pin proposals | Core | S31 | E1 | Timeline |
| E4 | **Scribe**: incident-log entry proposals from what happened (decisions, discoveries, actions) | Plus | S32 | E1 | Incident log |
| E5 | TTP proposals on the case matrix | Plus | S32 | E1 | MITRE |
| E6 | Asset and attack-graph edge proposals | Plus | S33 | E1 | Assets, attack graph |
| E7 | **Bulk accept rules**: e.g. auto-accept IOC proposals from a validated finding | Idea | — | E1 | — |

### F. Reporting

| Id | Feature | Level | Sprint | Depends on | Builds on |
|---|---|---|---|---|---|
| F1 | **Reporter**: report-section proposals from validated findings only, each sentence tied to its finding | Core | S32 | D2 | `report_sections_data`, report templates |
| F2 | **Executive summary draft** | Plus | S32 | F1 | `executive_summary` |
| F3 | **Report in the client's language** (templates are already language-free user content) | Plus | S33 | F1 | Report templates |
| F4 | **Executive briefing** for the `executive` role: KPIs and plain-language status | Plus | S34 | B3 | Executive role, dashboard |
| F5 | **Lessons-learned / post-incident review** draft at closure | Plus | S35 | F1 | Case closure |
| F6 | **Citation check** before delivery: every claim in the report still maps to a validated finding | Plus | S34 | F1 | — |

### G. Providers, governance and security

| Id | Feature | Level | Sprint | Depends on | Builds on |
|---|---|---|---|---|---|
| G1 | **LLM gateway with Ollama** (chat, streaming, tool calls) | Core | S30 | — | — |
| G2 | **Agent permission bundle** intersected with the launching user's | Core | S30 | — | `core/permissions.py`, scoping |
| G3 | **Approval queue** for side effects (CTI lookups, data leaving the host, budget overrun) | Core | S31 | A3 | — |
| G4 | **Cloud providers** (OpenAI-compatible, Anthropic, OpenAI), keys encrypted at rest | Plus | S34 | G1 | MFA secret encryption |
| G5 | **TLP routing policy** enforced in the gateway, denials audited | Core | S34 | G4 | `Case.tlp` |
| G6 | **Tokens and cost** per agent, task, case; dashboard tiles | Plus | S34 | G1 | `StatTile` |
| G7 | **Model per role or per agent**, from settings | Plus | S34 | G1 | — |
| G8 | **Prompt-injection defences**: fenced data, canary checks, quarantine of suspicious content, reviewer alert | Plus | S33 | C1 | — |
| G9 | **Evaluation bench**: golden cases from public datasets, expected findings, score per model and prompt; required before a prompt change merges | Plus | S34 | D1 | `samples/` |
| G10 | **Replay**: re-run a closed case's tasks with another model and diff the findings | Idea | — | G9 | — |

### H. Openness and knowledge

| Id | Feature | Level | Sprint | Depends on | Builds on |
|---|---|---|---|---|---|
| H1 | **MCP server** exposing case tools with the caller's permissions and audit | Plus | S35 | G2 | — |
| H2 | **MCP client**: third-party servers registered as tools, with locality and approval flags | Plus | S35 | G3 | Connectors page |
| H3 | **Knowledge retrieval**: agents cite the knowledge base and lessons from closed cases | Plus | S35 | G1 | `routers/knowledge.py` |
| H4 | **Detection engineering**: Sigma and YARA rules drafted from findings and tested against the case | Plus | S35 | D1 | Chainsaw rules |
| H5 | **External agents** (A2A or similar) as agent instances whose loop runs elsewhere | Idea | — | H1 | — |
| H6 | **Agents as collaborators in notes**: presence and suggestions in the collaborative editor | Idea | — | A3 | Yjs collab (S29) |

### I. Team life and training

| Id | Feature | Level | Sprint | Depends on | Builds on |
|---|---|---|---|---|---|
| I1 | **Notifications** when an agent is blocked or waiting on the analyst (in app, then webhook) | Plus | S32 | G3 | — |
| I2 | **Coach mode**: the leader asks the junior analyst the next question instead of answering it, and explains why | Idea | — | B2 | — |
| I3 | **Exercise mode**: a seeded sample case, a hidden ground truth, a score at the end | Idea | — | G9 | `samples/` |
| I4 | **Agent memory across cases** (per role, opt-in, never crossing client scopes) | Idea | — | H3 | Client scoping |

---

## 3. S30 in detail

The first sprint is deliberately narrow: one agent, read-only, visible.

1. `docs/CHARYBDIS.md` and this catalogue merged as the design of record.
2. Flag `CHARYBDIS_ENABLED`; `services/charybdis/` package skeleton.
3. Models `agent_instances`, `agent_tasks`, `agent_events` with their Alembic revision.
4. `agent` permission bundle and its tests (golden route list, read-only gate).
5. LLM gateway with the Ollama adapter; `extra_hosts` in compose; health check on the settings page.
6. Runner: single-step loop, tool schema validation, budget on steps.
7. Tools `case_overview`, `ingest_status`, `store_search`, `store_schema`.
8. WebSocket `/ws/cases/{id}/agents`; Team tab with one agent card, a chat and the live trace.
9. Smoke tests for every new route; unit tests for the gateway adapter and tool schemas.

Out of S30 on purpose: processes, multiple agents, proposals, cloud providers.
