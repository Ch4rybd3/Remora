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
- `{{attack_graph}}` — Attack graph PNG (DOCX) or placeholder text (MD)
- `{{mitre_matrix}}` — MITRE ATT&CK coverage table; parents expanded only when they have selected sub-techniques

---

## MITRE ATT&CK Integration (implemented)
- Backend: `models/mitre.py` (CaseTTP), `routers/mitre.py`
- Compact technique tree cached at `<evidence_store>/../mitre/attack_enterprise_compact.json`
- Endpoints: `GET /mitre/status`, `POST /mitre/download`, `GET /mitre/techniques`
- Case TTPs: `GET/POST/DELETE /cases/{id}/ttp`, `GET /cases/{id}/ttp/layer`, `POST /cases/{id}/ttp/import-layer`
- Navigator layer export uses ATT&CK Navigator v4.5 format
- Sub-techniques always visible nested below parent (controlled by global toggle in toolbar)
- Matrix tab: `MitreTab.tsx` — full horizontal scroll, 14 tactic columns, right selection panel

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
