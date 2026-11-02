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
| A10 | **Pause, resume, take over**: the analyst steps into a task mid-process, then hands it back | Plus | S33 | A5 | — |
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
| C9 | **Natural language → RQL**: the analyst asks in words, the agent shows the RQL it would run, the analyst runs or edits it | Plus | S33 | C1 | RQL parser |
| C10 | **"Ask an agent" from anywhere**: on an Explorer row, a timeline event, an IOC → explain, pivot, assess | Plus | S33 | C1 | Explorer `SidePanel` |
| C11 | **Ingestion triggers**: an artifact reaching `indexed` notifies the leader, which proposes the matching task | Plus | S33 | B2 | Ingest state machine |
| C12 | **Cross-case correlation**: IOCs and hashes seen in other cases, within the analyst's client scope | Plus | S35 | C3 | IOCs, client scoping |
| C13 | **Beyond Windows** analysts (Linux, macOS, mobile) as the platform grows | Idea | — | C3 | `PLATFORMS.md` |

### D. Findings, review and evidence

| Id | Feature | Level | Sprint | Depends on | Builds on |
|---|---|---|---|---|---|
| D1 | **Findings with mandatory evidence**, severity, confidence + justification, ATT&CK ids | Core | S32 | C3 | MITRE |
| D2 | **Analyst validation** (validate, reject with comment sent back to the author) | Core | S32 | D1 | — |
| D3 | **Reviewer agent**: does the cited evidence say what the finding claims? alternative explanations | Core | S32 | D1 | — |
| D4 | **Hypothesis board with competing-hypotheses matrix** (evidence for and against each) | Plus | S33 | D1 | — |
| D5 | **Clickable citations**: a citation opens the exact row in the Explorer side panel | Core | S32 | C3 | Explorer |
| D6 | **Tamper-evident trace**: `agent_events` chained by hash, verifiable and exportable | Plus | S32 | A3 | Audit |
| D7 | **Evidence strength scoring**: one weak source vs several independent corroborating sources | Idea | — | D1 | — |

### E. Proposals into Remora objects

| Id | Feature | Level | Sprint | Depends on | Builds on |
|---|---|---|---|---|---|
| E1 | **Proposals inbox**: accept, edit-then-accept, reject; accepted proposals go through the normal service and audit | Core | S31 | A3 | `audit_log` |
| E2 | IOC proposals, deduplicated against existing IOCs | Core | S31 | E1 | IOCs |
| E3 | Timeline pin proposals | Core | S31 | E1 | Timeline |
| E4 | **Scribe**: incident-log entry proposals from what happened (decisions, discoveries, actions) | Plus | S33 | E1 | Incident log |
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
| I1 | **Notifications** when an agent is blocked or waiting on the analyst (in app, then webhook) | Plus | S33 | G3 | — |
| I2 | **Coach mode**: the leader asks the junior analyst the next question instead of answering it, and explains why | Idea | — | B2 | — |
| I3 | **Exercise mode**: a seeded sample case, a hidden ground truth, a score at the end | Idea | — | G9 | `samples/` |
| I4 | **Agent memory across cases** (per role, opt-in, never crossing client scopes) | Idea | — | H3 | Client scoping |

---

## 3. S30 — delivered

The first sprint is deliberately narrow: one role, read-only, visible.
Delivers A1, A3, C1 and G1, plus the TLP check of G5 (enforced now, so it
exists before the first cloud provider does) and the hash-chained trace of D6.

| Piece | Where |
|---|---|
| Flag `CHARYBDIS_ENABLED`, Ollama URL, default model, step budget, concurrency, context window | `config.py`, `.env.example`, `docker-compose.yml` |
| `agent_instances`, `agent_tasks`, `agent_events` and their revision | `models/agent.py`, `alembic/versions/20261102_1000_c1a7e5d2b940_*` |
| Gateway, Ollama adapter (native `/api/chat`, tool calls, `num_ctx`), TLP policy, request semaphore | `services/charybdis/llm/` |
| Five read-only tools: `case_overview`, `ingest_status`, `list_artifacts`, `store_schema`, `store_search` | `services/charybdis/tools.py` |
| Agent permission bundle (`artifacts` only) intersected with the launching user's grants, re-read on every run | `tools.AGENT_PERMISSIONS`, `runtime._start` |
| Supervisor and loop: step budget, cancel, restart recovery | `services/charybdis/runtime.py` |
| Append-only trace, numbered per case, chained by SHA-256, verifiable | `services/charybdis/events.py`, `GET .../agents/events/verify` |
| Routes, audited (`agent.create`, `agent.update`, `agent.message`, `agent.task_cancel`) | `routers/agents.py`, `core/audit_routes.py` |
| Live socket `/api/v1/agents/ws?case_id=…&after_seq=…`, resumable | `routers/agents.py`, `nginx.conf` |
| Team tab: agent list with provider health, chat, live trace with chain check | `components/case/tabs/TeamTab.tsx`, `components/agents/` |
| Agent state tokens in all four themes | `styles/tokens.css` (`--agent-*`) |

Decisions taken while building it:

- **No route deletes an agent.** Its events are part of the case's hash chain;
  deleting them would break verification for every later event. An agent goes
  with its case.
- **The socket is not under `/cases/{case_id}`.** WebSockets do not run router
  dependencies, so it states its own rules (`authorise_socket`: active account,
  artifact access, case within client scope; out-of-scope answers "not found")
  and is tested for them.
- **`list_artifacts` was added** to the four planned tools: without it the model
  has no way to learn an artifact id.
- **Provider health is shown in the Team tab** rather than on a settings page,
  which arrives with model selection in S34.
- **Agent text renders as plain text.** It quotes artifact content, which is
  attacker-controlled.
- **Agent and task timestamps serialise with `Z`.** Remora's other schemas emit
  naive ISO strings, which the browser reads as local time; that is a
  pre-existing issue outside this module.

Running it: set `CHARYBDIS_ENABLED=true`, run Ollama on the host and pull a
model with native tool calling (`ollama pull qwen3:8b`). On Linux, Ollama must
listen beyond loopback (`OLLAMA_HOST=0.0.0.0`) for the container to reach it.

Out of S30 on purpose: YAML roles and processes, several roles, proposals,
cloud providers, token streaming.

---

## 4. S31 — delivered

Incident Leader and delegation. Delivers A4, A5, A6, A7 (step budget per
role), B1, B2, B3, C2, E1, E2 and E3, plus the case-object read tools the S30
trial showed were missing (the agent could count IOCs but not read them).

| Piece | Where |
|---|---|
| Roles `assistant`, `incident-leader`, `analyst-windows`; processes `conversation`, `leader-conversation`, `leader-review`, `analyst-investigation`; prompts and shared rules | `templates/agents/` |
| Loader that refuses unknown tools, missing processes or prompts, and step tools a role does not hold | `services/charybdis/definitions.py` |
| Process engine: a step ends when the model answers without a tool call; its answer is the step summary, the last one is the task report; tools offered per step | `services/charybdis/runtime.py` |
| Delegation through the leader: proposed tasks run once accepted, on the least busy agent of the role (staffed if absent); reports and help requests become leader tasks; dependencies on tasks and task proposals | `services/charybdis/delegation.py` |
| Tools: `list_iocs`, `list_assets`, `list_timeline`, `list_incident_log`, `list_ttps`, `chainsaw_alerts`, `process_tree`, `list_tasks`, `read_task`, `propose_task`, `propose_ioc`, `propose_timeline_event`, `request_help`; `ingest_status` explains each state | `services/charybdis/tools.py` |
| `agent_proposals`, and on `agent_tasks`: kind, process, step, parent, dependencies, report | `models/agent.py`, revision `d8b3f6a1c274` |
| Inbox routes: list, accept (with edits), reject (with comment); default-team staffing | `routers/agents.py` |
| Team tab: hierarchy, role picker, default team, Chat / Tasks / Proposals views; `Agent` origin badge on the timeline | `components/agents/`, `TeamTab.tsx` |

Decisions taken while building it:

- **The step boundary is a plain answer, not a `complete_step` tool.** Small
  local models end a turn with text reliably; asking them to call a tool to
  say they are done is one more thing to get wrong.
- **Proposals need the analyst to be able to write.** An agent's grants are
  `artifacts` if its analyst reads artifacts, plus `propose` if they can
  write - a read-only account has nothing to approve with.
- **Accepting calls the existing handlers** (`create_ioc`, `create_event`), so
  validation and the `ioc.create` / `timeline.create` audit entries are those
  of a hand-made object. Accepting and creating are two commits; a failure
  between them leaves an IOC and an open proposal, never the reverse.
- **A rejection's comment is fed back** to the proposing agent the next time
  it works, as part of its history.
- **Deduplication** refuses an IOC already in the case or already proposed,
  and a timeline event with the same time and title.
- **A message no longer waits for assigned work to be refused:** only an open
  conversation blocks the chat; a message queues behind assigned tasks.
- **`charybdis_max_steps` became a ceiling** (40) over the per-role budgets.
- **The approval queue (G3) moves to the sprint that adds CTI lookups.** No
  S31 tool has a side effect outside the module's own tables.

Known limits, left for the reliability pass the analyst asked to defer:
analyst answers depend heavily on the model (an 8B model misses things a
human would not), and batch EZ parsing currently fails on output directory
permissions, so some EVTX never reach the Explorer the analyst searches.

---

## 5. S32 — delivered

Findings and review. Delivers C3, D1, D2, D3, D5, D6 (export), E5, F1 and
F2. A10, C9, C10, D4, E4 and I1 move to S33: each needs either a trigger or a
synchronous model call outside a task, which S33 brings anyway.

| Piece | Where |
|---|---|
| `agent_observations` (the cited row, its RQL locator, a copy of the row) and `agent_findings` (claim, severity, confidence and why, ATT&CK ids, observations, review, decision) | `models/agent.py`, revision `e4c9a2b7d815` |
| `record_observation` re-reads the row from the store and refuses a filter that does not match exactly one row | `services/charybdis/tools.py` |
| `propose_finding`, `list_findings`, `read_finding`, `review_finding`; findings numbered per case (F1, F2...) | `services/charybdis/tools.py` |
| A new finding goes to the case's reviewer as a `review` task; a review that ends without a verdict (failed, cancelled, interrupted) still hands the finding to the analyst | `services/charybdis/delegation.py` |
| Roles `reviewer` and `reporter`, processes `review-finding` and `report-drafting`; `assignable` in role files | `templates/agents/` |
| `report_outline`, `propose_report_section`, `propose_executive_summary`: every paragraph cites `[Fn]`, every cited finding is validated | `services/charybdis/tools.py` |
| `propose_ttp`, accepted through the case matrix handler | `services/charybdis/tools.py`, `routers/agents.py` |
| Routes: findings list, validate, reject (audited), one observation, trace export as JSON lines with the hash chain | `routers/agents.py` |
| Findings view with clickable citations; the Explorer opens `?observation=<id>` on its table, filtered to the row, the row in the detail panel | `components/agents/FindingsBoard.tsx`, `pages/ArtifactExplorer.tsx` |

Decisions taken while building it:

- **A citation is verified when it is made, not when it is read.** The
  agent names an artifact and an RQL filter; the store must return exactly
  one row, which is copied. A model that misremembers a record id gets an
  error it can correct, never a citation pointing at nothing. The copy keeps
  the citation readable if the table is later removed from the Explorer.
- **Findings are their own objects, not proposals.** A proposal becomes a
  Remora object when accepted; a finding stays a Charybdis object that the
  report cites. Validating it writes nothing outside the module.
- **The review informs, it does not gate.** The analyst can decide on a
  finding still in review. An "unsupported" verdict is shown in the analyst's
  inbox and fed back to the author; it does not reject the finding by itself.
- **The reviewer is never staffed on demand.** On one GPU, a model run per
  finding the analyst did not ask for is a cost they should choose; without a
  reviewer on the case, findings go straight to the analyst.
- **Report citations are per paragraph, not per sentence.** An 8B model ties
  paragraphs to findings reliably; per sentence it mostly fails the check.
  The `[Fn]` marks are removed when the text is accepted: they are internal
  references, not something the client reads.
- **Accepted report text is appended, never written over** what the section
  or the executive summary already holds. Accepting goes through the report
  save and case update handlers, so `report.save` and `case.update` are
  audited as the analyst's and a report version is kept.

Known limits: the reporter can only be as good as the findings it is given,
and the reviewer runs on the same small model as the author. Both are part of
the reliability pass.
