# Remora — Development Standards

## Project
DFIR case management platform. Dark UI, accent color `accent-green`. Backend: FastAPI + SQLAlchemy + SQLite. Frontend: React + TypeScript + TanStack Query + Tailwind.

---

## Timeline Explorer Pattern
Any feature that surfaces forensic events must support "Add to Timeline":

- **Pin button: first column (leftmost)** of every table row — `onClick={e => e.stopPropagation()}`
- **Selection panel: always visible on the right** — never behind a toggle button (`w-60 shrink-0 border-l`)
- **Pinned items: sorted chronologically** (oldest first) in the panel — use `useMemo` + `.sort()`
- **"Send to Timeline"** uses `timelineApi.addEvent()`, invalidates `['timeline', caseId]`
- **Auto-save selection** to backend on unmount and debounced on change
- Selection panel shows count badge in toolbar when items are pinned

---

## File Sidebar Selection Pattern
When a page has a left file-list sidebar (like Logs, Chainsaw, MFT, USN):

- Clicking a file row **selects** it and filters the main content to that file
- Selected row: `bg-accent-green/5 border-l-2 border-l-accent-green/40`
- Action buttons inside rows must call `e.stopPropagation()` to prevent row toggle
- `selectedFileId` state: `string | null`, deselect by clicking same row again
- Pass `file_id` to backend queries as an optional filter param

---

## Default Filter State
- Level/type filters: **show ALL items by default** (empty Set = no restriction)
- Always include an **"All" chip** that clears the filter (`setFilter(new Set())`)
- All level chips appear **colored/active** when filter is empty (conveys "everything shown")
- Level chip is dimmed only when another level is exclusively selected

---

## Backend: New Feature Checklist
1. `models/<feature>.py` — SQLAlchemy model, cascade `ondelete="CASCADE"` on FKs
2. `routers/<feature>.py` — FastAPI router, `prefix="/api/v1/..."`, auth via `Depends(get_current_user)`
3. `main.py` — import model (`from .models import <feature> as _<feature>_models`) and router, register with `app.include_router(..., prefix="/api/v1", **_auth)`
4. Use `print(..., flush=True)` for critical log lines (not Python `logging`) so they always appear in uvicorn stdout
5. Heavy operations (downloads, scans) run via `BackgroundTasks`

---

## Frontend: New Feature Checklist
1. `api/<feature>.ts` — typed API client, base URL `/api/v1`, `credentials: 'include'`
2. `components/case/tabs/<Feature>Tab.tsx` — tab component, receives `{ caseId: string }`
3. `pages/CaseDetail.tsx` — add to `Tab` union type, `TABS` array, import, and render
4. Full-height tabs (matrix, graph): render directly in `<div className="h-full">`, skip the padded wrapper
5. Use `useQuery` / `useMutation` from TanStack Query; invalidate on mutations

---

## SQLAlchemy Cascade Notes
- `bulk delete` (`.delete(synchronize_session=False)`) does NOT trigger ORM cascade
- Always delete child rows explicitly before parent rows in background tasks
- Use `cascade="all, delete-orphan"` on `relationship()` for ORM-level deletes

---

## Report Template Tags
To add a section to auto-generated case reports, add a `_render_<section>` method to `backend/app/services/report_service.py` and include it in the `generate()` f-string.

Current tags rendered automatically:
- Executive Summary, Notes, MITRE ATT&CK TTPs, IOCs, Assets, Evidence, Timeline

### DOCX/MD block tags (in `report_doc_templates.py`)
- `{{ioc_table}}` — IOC table
- `{{asset_table}}` — Asset table
- `{{evidence_table}}` — Evidence table
- `{{timeline_table}}` — Timeline table
- `{{mitre_matrix}}` — MITRE ATT&CK coverage table (text); parents expanded only when they have selected sub-techniques
- `{{mitre_matrix_img}}` — MITRE ATT&CK matrix as a **visual PNG image** (DOCX only; placeholder in MD)
- `{{attack_graph}}` — Attack graph image (ReactFlow nodes rendered via matplotlib)

#### `{{attack_graph}}` — Attack graph rendering

**DOCX**: replaced with an actual **PNG image** (6 inches wide, embedded inline).
- Rendered server-side with **matplotlib (Agg backend)** from the ReactFlow `AttackGraph` model (`nodes` + `edges` stored in DB).
- Visual style mirrors the Attack Graph tab: dark background (`#0B121F`), rounded-rect nodes, directional arrows.
- Node colours per type:
  - `timeline` → green border `#9FEF00`
  - `asset` → blue `#3b82f6` / red `#ef4444` if compromised
  - `attacker` → red `#ef4444`
  - `ioc` → colour per IOC type (ip=red, domain=orange, hash=purple, email=blue, …)
  - `free` → grey `#4b5563`
- Figure size auto-scales to graph bounding box (10–20 in wide, 6–14 in high), DPI 150.
- Falls back to `[Attack graph not available — no data recorded]` if the case has no graph nodes, or if matplotlib is not installed.

**Markdown**: replaced with placeholder text `_[Attach the attack graph image — export it from the Attack Graph tab]_` — no image embedding in MD.

**Prerequisite**: the case must have an Attack Graph built (Attack Graph tab → save nodes/edges). If the graph is empty, the placeholder is used even in DOCX.

#### `{{mitre_matrix_img}}` — Visual MITRE ATT&CK matrix

**DOCX**: replaced with a **PNG image** of a simplified ATT&CK matrix embedded inline.
- Rendered server-side with **matplotlib (Agg backend)** from the case's `CaseTTP` records.
- **Single-row layout**: all active tactic columns on one row (no wrapping).
- **Auto-width columns**: each column is sized to fit its longest technique name/ID — no text truncation.
- Embedded width = natural figure width, capped at 6.5 inches. Embed width is computed automatically and passed to python-docx.
- Tactic headers are color-coded matching the Remora UI (lime for Stealth, fuchsia for Defense Impairment, etc.).
- White cards with a colored left accent stripe; sub-techniques indented and on a light-green background.
- ATT&CK v19 tactic order: Recon → Rsrc Dev → Initial Access → Execution → Persistence → Priv. Escalation → **Stealth** → **Def. Impairment** → Cred. Access → Discovery → Lateral Movement → Collection → C2 → Exfiltration → Impact.
- TTPs saved with the **legacy `defense-evasion` slug** (ATT&CK ≤ v18) appear at the end as a grey **"Def. Evasion (legacy)"** column. To fix: delete and re-add those TTPs from the updated Stealth / Defense Impairment matrix columns.
- Any other unknown tactic slugs are also appended as extra columns at the end.
- Falls back to `[MITRE ATT&CK matrix — no techniques recorded]` if the case has no TTPs, or if matplotlib is unavailable.
- DPI: 200.

**Markdown**: replaced with placeholder `_[MITRE ATT&CK matrix image — available in DOCX export only]_`.

**vs `{{mitre_matrix}}`**: use `{{mitre_matrix}}` for a searchable/editable text table; use `{{mitre_matrix_img}}` for a visual presentation-quality matrix image in the document.

---

## MITRE ATT&CK Integration (implemented)
- Backend: `models/mitre.py` (CaseTTP), `routers/mitre.py`
- Compact technique tree cached at `<evidence_store>/../mitre/attack_enterprise_compact.json`
- Endpoints: `GET /mitre/status`, `POST /mitre/download`, `GET /mitre/techniques`
- Case TTPs: `GET/POST/DELETE /cases/{id}/ttp`, `GET /cases/{id}/ttp/layer`, `POST /cases/{id}/ttp/import-layer`
- Navigator layer export uses ATT&CK Navigator v4.5 format
- Sub-techniques always visible nested below parent (controlled by global toggle in toolbar)
- Matrix tab: `MitreTab.tsx` — full horizontal scroll, 15 tactic columns (ATT&CK v19), right selection panel
- **ATT&CK v19 tactic change**: "Defense Evasion" (TA0005) was split into two tactics:
  - `stealth` (TA0005) — obfuscation, masquerading, living-off-the-land
  - `defense-impairment` (TA0112) — disabling EDRs, clearing logs, breaking security tools
  - Do NOT use `defense-evasion` as a tactic short name; it no longer exists in v19 STIX

### Case Template TTP seeding
Add `ttp_definitions` list to a case template YAML to pre-populate TTPs on case creation:
```yaml
ttp_definitions:
  - technique_id: T1566.001
    technique_name: Spearphishing Attachment
    tactic: initial-access
    tactic_name: Initial Access
  - technique_id: T1059.001
    technique_name: PowerShell
    tactic: execution
    tactic_name: Execution
```
Seeding happens in `routers/cases.py` `create_case()` after `db.flush()`.

### Template TTP visual editor (implemented)
- Backend: `PUT /templates/{id}/ttps` — replaces `ttp_definitions` in the YAML via `yaml.safe_load` + `yaml.dump`
- Shared matrix component: `components/mitre/MitreMatrixPicker.tsx` — TechCard, TacticColumn, picker wrapper
  - Used by `MitreTab` (case-level) and `TemplateTTPModal` (template-level)
- `TemplateTTPModal.tsx` — full-screen modal, initialises `selectedMap` from template's `ttp_definitions`, calls `templatesApi.updateTTPs()` on save
- Templates page: "TTPs" button with count badge on each card; "YAML" button kept separate for raw editing
