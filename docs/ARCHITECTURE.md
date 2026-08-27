# Remora — Architecture

Module layout and cross-cutting technical notes.
Process rules live in `CONVENTIONS.md`; the checklists below are the
authoritative version and are mirrored there.

---

## Project
DFIR case management platform. Dark UI, single teal accent (`--accent`, `#2DD4BF`). Backend: FastAPI + SQLAlchemy + SQLite. Frontend: React + TypeScript + TanStack Query + Tailwind.

---


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
