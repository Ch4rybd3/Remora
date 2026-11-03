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
| A8 | **Team templates**: a case template names the team to staff on creation (ransomware → leader, two Windows, memory, timeline, reporter) | Plus | S34 | A4 | Case templates (`ttp_definitions` precedent) |
| A9 | **Process and role editor** in the UI, with YAML view like templates | Plus | S35 | A4 | Templates page |
| A10 | **Pause, resume, take over**: the analyst steps into a task mid-process, then hands it back | Plus | S34 | A5 | — |
| A11 | **Playbook steps assignable to agents**: a Remora playbook step can name an agent role as assignee | Plus | S34 | A5 | Playbooks |

### B. Incident leadership

| Id | Feature | Level | Sprint | Depends on | Builds on |
|---|---|---|---|---|---|
| B1 | **Scoping interview**: what, when, who detected, critical assets, actions already taken; answers proposed into case description and assets | Core | S31 | A4 | Case, assets |
| B2 | **Investigation plan**: hypotheses → tasks → assignment, shown as a card the analyst approves | Core | S31 | B1 | — |
| B3 | **Situation report on demand** ("where are we?"): confirmed, open, blocked, next | Core | S31 | B2 | — |
| B4 | **Coverage gap analysis**: which artifacts are missing to answer each hypothesis, turned into a **collection request list** per host | Plus | S34 | B2 | `COVERAGE.md`, coverage router |
| B5 | **Phase tracking** (identification → containment → eradication → recovery → lessons) with phase-appropriate questions | Plus | S34 | B2 | Case status |
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
| C11 | **Evidence triggers**: new evidence (a table, an email, a memory dump, a binary) notifies the leader, which routes it from the case context | Plus | S33, reworked S34 | B2 | Explorer, email, memory and binary tables |
| C12 | **Cross-case correlation**: IOCs and hashes seen in other cases, within the analyst's client scope | Plus | S35 | C3 | IOCs, client scoping |
| C13 | **Beyond Windows** analysts (Linux, macOS, mobile) as the platform grows | Idea | — | C3 | `PLATFORMS.md` |

### D. Findings, review and evidence

| Id | Feature | Level | Sprint | Depends on | Builds on |
|---|---|---|---|---|---|
| D1 | **Findings with mandatory evidence**, severity, confidence + justification, ATT&CK ids | Core | S32 | C3 | MITRE |
| D2 | **Analyst validation** (validate, reject with comment sent back to the author) | Core | S32 | D1 | — |
| D3 | **Reviewer agent**: does the cited evidence say what the finding claims? alternative explanations | Core | S32 | D1 | — |
| D4 | **Hypothesis board with competing-hypotheses matrix** (evidence for and against each) | Plus | S34 | D1 | — |
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
| E6 | Asset and attack-graph edge proposals | Plus | S34 | E1 | Assets, attack graph |
| E7 | **Bulk accept rules**: e.g. auto-accept IOC proposals from a validated finding | Idea | — | E1 | — |

### F. Reporting

| Id | Feature | Level | Sprint | Depends on | Builds on |
|---|---|---|---|---|---|
| F1 | **Reporter**: report-section proposals from validated findings only, each sentence tied to its finding | Core | S32 | D2 | `report_sections_data`, report templates |
| F2 | **Executive summary draft** | Plus | S32 | F1 | `executive_summary` |
| F3 | **Report in the client's language** (templates are already language-free user content) | Plus | S34 | F1 | Report templates |
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
| G8 | **Prompt-injection defences**: fenced data, canary checks, quarantine of suspicious content, reviewer alert | Plus | S34 | C1 | — |
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

---

## 6. S33 — delivered

Specialists and triggers. Delivers C4, C5, C6, C7, C8, C9, C10, C11, E4 and
I1 (in app). A8, A10, A11, B4, B5, D4, E6, F3 and G8 move to S34.

| Piece | Where |
|---|---|
| Ingestion triggers: the supervisor polls for files that reached `indexed`, `browsable` or `parsed` since the leader was staffed, and gives the leader one `trigger` task listing them; later files join it while it waits | `services/charybdis/triggers.py`, `runtime.py`, `agent_ingest_notices` (revision `f2d6b8c4a913`) |
| Roles `analyst-memory`, `analyst-network`, `analyst-email`, `analyst-binary`, `analyst-timeline`, `scribe`; processes `specialist-investigation`, `scribe-recording` | `templates/agents/` |
| Tools: `store_aggregate`, `list_memory_dumps`, `memory_output`, `list_emails`, `read_email`, `list_binaries`, `read_binary`, `record_source_observation`, `propose_log_entry` | `services/charybdis/tools.py` |
| Observations carry their source (`artifact`, `memory`, `email`, `binary`); a non-table citation opens the module page that holds it | `agent_observations.source_kind`, `FindingsBoard.tsx` |
| Incident log proposals, accepted through the incident log handler (which also writes the timeline) | `routers/agents.py` |
| Attention: proposals, findings and stopped agents counted on the case's Team tab, polled and pushed | `GET /attention`, `CaseDetail.tsx` |
| Ask an agent from an Explorer row: the case assistant (staffed if absent) gets the question and the row, quoted as data | `POST /ask`, `RowDetailPanel.tsx` |
| Draft query: a question in words becomes RQL, checked against the parser and the table's columns, put in the query box and never run | `POST /rql-draft`, `services/charybdis/assist.py`, `RQLBar.tsx` |

Decisions taken while building it:

- **The leader is told by polling, not by the pipeline calling in.** Files
  reach a final state from the drop folder, collection imports, uploads and
  retries; a poll catches all of them without the ingestion code knowing the
  module exists. Only cases with a leader are watched, and only files that
  arrived after it.
- **Specialists read what Remora already produced; they do not run tools.**
  The memory analyst reads plugin output the analyst ran; running Volatility
  is a heavy side effect and stays the analyst's. The same holds for email and
  binary analysis.
- **A citation outside a table is a quote.** The agent names the plugin, the
  email part or the binary part and quotes the text; Remora looks it up now,
  refuses a quote that matches nothing or more than five entries, and copies
  what matched.
- **Drafting RQL sends a few rows to the model, so it is audited** and goes
  through the gateway's TLP policy like everything else. A draft that does not
  compile is sent back once with the parser's error.
- **"Ask an agent" goes to the case assistant**, a read-only role, not to the
  leader: a question about one row should not start delegation.
- **Notifications stay in the app in this sprint.** A webhook needs the
  approval queue's notion of who may be told what, which S34 brings.

Known limits: the specialists are only as useful as what has been processed -
a memory dump with no plugin run gives the memory analyst nothing to read.
Drafting RQL was checked against a scripted model only; the reliability pass
will measure it on qwen3:8b.

---

## 7. S34, part 1 — leader autonomy on new evidence

Analyst feedback on S33: a CSV uploaded through the Explorer reached no one.
This part fixes that and makes the leader route evidence from what the case
says it is. The rest of S34 (providers and governance) follows.

| Piece | Where |
|---|---|
| Evidence triggers watch what agents read - Explorer tables, emails, memory dumps, binaries - whatever button or folder they came through | `services/charybdis/triggers.py`, `agent_evidence_notices` (revision `a7e3c1d9f450`, replaces `agent_ingest_notices`) |
| The announcement carries the case's title, type, severity, TLP, tags and description, and a suggested reader per item | `triggers.case_context`, `triggers.INSTRUCTIONS` |
| Auto-start, per case: the leader's proposed tasks start without approval; the role is staffed if absent | `agent_instances.auto_start`, `delegation.auto_start`, Team tab |
| Auto-start guards: a task starts on its own only if its role has something to read in the case, and at most three per leader run; the rest wait, with the reason | `delegation.auto_start_refusal` |
| `list_evidence`: everything readable in the case with the id each tool takes, first in every analyst's process | `services/charybdis/tools.py`, processes |
| Steps whose work is a tool call (`expects_tools`) remind a model that answered in text once | `definitions.StepDef`, `runtime.REMINDER` |

Decisions taken while building it:

- **The trigger watches outputs, not the ingestion log.** S33 watched
  `ingested_files`, which only the drop folder writes. The Explorer, email,
  memory and binary pages each have their own upload, and what matters to an
  agent is that something readable appeared.
- **The case decides the route; the file type only suggests it.** The
  suggested reader comes from the file type; the leader reads it next to the
  case description, so an email in a phishing case goes to the email analyst
  first, and a role with nothing to read in the case gets no work.
- **Auto-start is the analyst's choice, per case, for tasks only.** It relaxes
  principle P1 for work that reads the case and proposes - nothing a task does
  reaches the case without a decision. Findings, indicators, timeline events
  and report text still wait. Each automatic start is recorded as accepted by
  the leader "(auto-start)" and audited as `agent.proposal_auto_start` under
  the analyst who staffed it.

Checked against qwen3:8b on Docker (Ollama on the host), which is how these
last three pieces came about:

- `Parsed2.0.csv` uploaded through the Explorer reached the leader of a case
  described as lateral movement and credential theft, which gave it to the
  Windows analyst with those questions. `invoice.eml` in a case described as
  phishing went to the email analyst first.
- First run: the email analyst's first step only offered `ingest_status`,
  which does not see page uploads, and it concluded the email was missing -
  hence `list_evidence`. It also wrote "Proposed findings:" as text and
  proposed nothing - hence the reminder. With auto-start on, the leader then
  started five network tasks on a case with no network data - hence the
  guards.
- Second run: the network and timeline tasks waited for the analyst; the
  email analyst read the email and proposed the two malicious domains as
  indicators. Its findings were refused for citing tool names instead of
  observation ids; the refusal now says how to record them. It also chose the
  wrong technique (T1190 for a phishing link); the email prompt now names
  T1566.002. Both belong to the reliability pass.

---

## 8. S34, part 2 — providers and governance

Delivers G4, G5 (audited denials), G6 and G7. The evaluation bench (G9) and
the items moved here from S33 follow.

| Piece | Where |
|---|---|
| `agent_providers`: providers beside Ollama - Claude (official `anthropic` SDK) and any OpenAI-compatible server - with locality, default model and prices; API keys encrypted at rest like MFA secrets, never returned | `models/agent.py` (revision `b5d2e8f1a367`), `llm/anthropic_provider.py`, `llm/openai_compat.py`, `llm/gateway.py` |
| A TLP refusal is audited as `agent.policy_denied`, from a task or from Draft query | `runtime._audit_denial`, `routers/agents.py` |
| Cost per task (`agent_tasks.cost_usd`), per agent and per case (`GET /usage`), shown on the Team tab and the task board | `runtime._usage` |
| Model per role (`agent_role_models`): what new agents of a role are staffed with; a provider per agent from the chat header | Agent models page, Team tab |
| Agent models page (administrators): add, test, edit, disable, remove providers; model per role | `pages/AgentModels.tsx`, `/config/agents` |

Decisions taken while building it:

- **Locality is declared by the administrator.** The same OpenAI protocol
  runs on the analyst's GPU (LM Studio, vLLM) and at a vendor; only the person
  configuring it knows which, and the TLP policy is decided on that alone.
- **Claude turns are replayed as received.** An assistant turn from Claude is
  a list of content blocks, thinking included, which must come back unchanged;
  `ChatResult.raw` carries them to the next request. Other providers ignore it.
- **Refusals are handled, not hidden.** Claude requests use the server-side
  refusal fallback (`fallbacks: "default"`), so a safety decline is re-run on a
  model that serves it in the same call; a refusal that remains fails the task
  with a message saying so.
- **Cost is recorded per call, at the prices of that moment.** Changing a
  provider's prices later does not rewrite what earlier work cost.
- **A provider cannot be renamed** - agents refer to it by name. Removing one
  is audited with the number of agents still on it, which then fail with a
  message naming it; disabling keeps them listed.

---

## 9. S34, part 3 — bench, hypotheses, taking over

Delivers G9, D4 and A10. Still planned: A8, A11, B4-B7, E6, F3, F4, F6, G8.

| Piece | Where |
|---|---|
| Evaluation bench: golden cases (evidence with known content, a role, an objective, expectations) run on one model in a scratch case deleted afterwards, scored per expectation, with calls, tokens and cost | `templates/agents/bench/`, `services/charybdis/bench.py`, `agent_bench_runs` (revision `c8f4a1e6b293`), Agent models page |
| Two golden cases to start: an RDP intrusion on a domain controller (Windows analyst) and an invoice phishing email (email analyst), both synthetic | `templates/agents/bench/` |
| Hypotheses (H1, H2...) and a matrix of findings for and against each; the leader states and weighs, the analyst decides | `agent_hypotheses`, `agent_hypothesis_links`, tools `state_hypothesis`, `weigh_finding`, `list_hypotheses`, Hypotheses view |
| Pause a task after its current model call, resume it with instructions; it restarts at the step it reached with the summaries of the steps it completed | `TASK_PAUSED`, `runtime._resumed`, task board |
| Deleting a case removes its agent rows: SQLite runs without foreign key enforcement, so `ON DELETE CASCADE` alone left them behind since S30 | `delegation.purge_case`, `routers/cases.py` |

Decisions taken while building it:

- **A golden case scores outcomes, not wording.** An expectation is an
  indicator proposed, a technique proposed, a finding or report naming
  something, a row cited. The same case run on two models, or before and
  after a prompt change, is compared by score, calls and cost.
- **Golden cases live with the roles they exercise**, in
  `templates/agents/bench/`, so a prompt change and the evidence it is
  measured on are reviewed together. The two shipped are synthetic: public
  datasets are large and their licences vary; adding one is adding a YAML file
  and its evidence.
- **A bench run never touches a real case.** It builds a scratch case,
  deletes it with its agents when the run ends, and keeps only the score.
- **Hypotheses are working notes, not case objects.** The leader states them
  directly; nothing reaches the case. The analyst decides each one; the board
  counts what is against each, which is how analysis of competing hypotheses
  is read.
- **Pausing keeps the work done, not the conversation.** Model calls are not
  stored; completed steps' summaries are on the trace, and are what the next
  step needs. The analyst's instructions are given before the step resumes.

First bench runs, on the analyst's machine (RTX 3060 Ti, Ollama), as the
baseline the tuning work starts from:

| Golden case | Model | Score | Calls | Tokens |
|---|---|---|---|---|
| invoice-phishing | qwen3:8b | 2/5 | 10 | 46 495 |
| rdp-intrusion | qwen3:8b | 3/5 | 15 | 80 880 |
| invoice-phishing | llama3 | 0/5 | 0 | 0 - refused: the model has no tool calling |

qwen3:8b finds the main indicator and the account in both; it misses the
look-alike sender domain, the persistence service and the cleared log, and in
the phishing case states its verdict in text without proposing it as a finding.
