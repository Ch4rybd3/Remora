# Remora — Development Conventions

Binding rules for every contribution. Deviations need a written reason in the PR.
Companion documents: `ARCHITECTURE.md` (module layout), `UI_PATTERNS.md`
(interaction patterns), `INGESTION.md` (artifact pipeline).

---

## 1. Language

**All source is English.** Code, identifiers, comments, docstrings, UI strings,
API error messages, log lines, commit messages, documentation.

There is no i18n framework and none is planned. Strings are hardcoded.

**Not covered by this rule** — this is user data, not source:
- case names, notes, report content, incident-log entries stored in the database;
- case templates, playbooks and report templates under `templates/` and `samples/`, which analysts author in whatever language the client requires.

Enforced in CI by a full-repository scan:

```yaml
- name: English-only source
  run: |
    ! grep -rIn "[éèêàùçôîœâêûïëäöüñ]" backend/app frontend/src \
        --include='*.py' --include='*.ts' --include='*.tsx'
```

The gate catches accented characters, which is a proxy for French, not a proof
of English. Reviewers still reject unaccented French (`Erreur`, `Fichier`, `Cas`).

---

## 2. Git

### Branches
| Branch | Role |
|---|---|
| `main` | Production. Protected, linear history, tagged releases only. |
| `integration` | Preprod. Every feature branch targets this. |
| `feat/<slug>` `fix/<slug>` `chore/<slug>` `docs/<slug>` | Unit branches. One concern each. |
| `spike/<slug>` | Timeboxed experiments. Never merged; findings are written up, code is discarded. |

Feature branches are **squash-merged** into `integration`. `integration` is
**merge-committed** into `main` — that merge is what produces a release.

### Commits
Conventional Commits. Because merges are squashed, **the PR title is the commit
message** and is linted as such.

```
feat(ingest): route EVTX by magic bytes
fix(explorer): keep column filters across pagination
chore(deps): bump duckdb to 1.2
docs(conventions): document the icon registry
```

Types: `feat` `fix` `chore` `docs` `refactor` `perf` `test` `build` `ci`.
Scope is the module (`ingest`, `explorer`, `mitre`, `report`, `auth`, …).

`feat` bumps the minor, `fix` the patch, `!` or a `BREAKING CHANGE:` footer the
major. Release notes are generated from these, so a lazy commit message becomes
a lazy public changelog.

### Pull requests
- One concern per PR. A PR that renames things *and* changes behaviour will be asked to split.
- A PR touching `backend/app/models/` needs an Alembic revision whenever the *schema* changes. This is enforced by `test_models_match_the_migrated_schema`, which compares the live schema against the models — not by a rule about which files were edited, because a cosmetic edit to a model file needs no migration and an empty revision would satisfy such a rule anyway.
- Green CI is required to merge. Never merge through a red check.

---

## 3. Versioning and releases

- SemVer, single-sourced in `backend/app/__version__.py`. `frontend/package.json` reads it at build time.
- `release-please` maintains a release PR against `main`; merging it tags the commit, updates `CHANGELOG.md`, and publishes the GitHub release.
- `GET /api/v1/version` returns version, commit SHA and build date. The sidebar footer displays the version.
- Never tag by hand.

---

## 4. Backend

### New feature checklist
1. `models/<feature>.py` — SQLAlchemy model. Foreign keys carry `ondelete="CASCADE"`.
2. **Alembic revision in the same commit.** No exceptions.
3. `schemas/<feature>.py` — Pydantic request/response models. Routers never return ORM objects directly.
4. `routers/<feature>.py` — `prefix="/api/v1/..."`, auth via `Depends(get_current_user)`.
5. `main.py` — import the model as `from .models import <feature> as _<feature>_models`, register the router with `app.include_router(..., prefix="/api/v1", **_auth)`.
6. Business logic lives in `services/`. **A router body over ~40 lines is a service that has not been extracted yet.**
7. Heavy work (downloads, scans, parsing) runs through `BackgroundTasks`, never inline in the request.

### Errors
`HTTPException(status_code=..., detail="...")` with an English, actionable
message naming the entity:

```python
raise HTTPException(status_code=404, detail="Case not found")
raise HTTPException(status_code=409, detail="File already ingested in this case")
```

Never leak a stack trace or a filesystem path into `detail`.

### Logging
`print(..., flush=True)` for lines that must appear in uvicorn stdout. Python
`logging` is buffered behind uvicorn's configuration and its output is
unreliable in this deployment. Prefix with the module:

```python
print(f"[ingest] identified {path.name} as {kind} ({sha256[:12]})", flush=True)
```

### SQLAlchemy cascade
- Bulk delete (`.delete(synchronize_session=False)`) does **not** trigger ORM cascade.
- Always delete child rows explicitly before parent rows in background tasks.
- `cascade="all, delete-orphan"` on `relationship()` covers ORM-level deletes only.

### Linting
`ruff` is scoped to the rules that catch defects — `F` (pyflakes) and `E9` — and
is blocking. The style rules (`E`, `I`, `B`, `UP`, `C4`) report ~730 further
violations across code written before linting existed; they land as one
mechanical `ruff check --fix` pass in S12.

`mypy` runs as a **ratchet**. 61 of 102 modules are enforced; the 41 that
predate type checking are exempted by name in `pyproject.toml`. A module may be
**removed** from that list once it is clean. Nothing may ever be **added** to
it — so anything new is type-checked by default.

### Tests
- Every new router gets an entry in the generated route smoke test (authenticated → not 5xx, anonymous → 401).
- Pure functions in `services/` — parsers, detectors, normalisers — get real unit tests. These are where a silent bug is most expensive.
- No coverage threshold. The gate is a green suite.

---

## 5. Frontend

### New feature checklist
1. `api/<feature>.ts` — typed client, base URL `/api/v1`, `credentials: 'include'`.
2. `components/case/tabs/<Feature>Tab.tsx` for a case tab (receives `{ caseId: string }`), or `pages/<Feature>.tsx` for a top-level page.
3. `pages/CaseDetail.tsx` — extend the `Tab` union, the `TABS` array, the import and the render.
4. `useQuery` / `useMutation` from TanStack Query. Invalidate the affected keys on every mutation.
5. Query keys are arrays, most general first: `['artifacts', caseId, fileId]`.

### Page contract
Every page is a `PageShell`, enforced by `npm run check:pages` in CI. The slots
are fixed; a page that needs a different arrangement is a design-system gap to
raise, not a local exception. Four pages are exempt by name, each with its
reason recorded in the check — see `docs/UI_PATTERNS.md`.

```
┌────────────────────────────────────────────────────┐
│ header    title · subtitle · primary action · help │
├────────────────────────────────────────────────────┤
│ toolbar   search · filter chips · view controls    │
├──────────┬────────────────────────┬────────────────┤
│ aside-l  │ content                │ aside-r        │
│ (files)  │                        │ (selection)    │
└──────────┴────────────────────────┴────────────────┘
```

- The `?` help affordance lives in the header, on **every** page.
- Full-height content (matrix, graph, explorer) renders into `content` without the padded wrapper.

### Icons
`lucide-react` is imported in exactly one file: `frontend/src/ui/icons.ts`.
Everything else imports from there, and eslint's `no-restricted-imports`
enforces it — the registry is the only exemption.

The file has two halves:

- **`NAV_ICON`** — destination route to icon. The semantic layer. Anything that
  renders a destination (sidebar, breadcrumbs, tabs, empty states) reads it from
  here, so two places cannot disagree. A test asserts every route has an icon
  and no icon serves two routes.
- **Re-exports** — the long tail of one-off icons, under their lucide names.
  Routing them through this file is what makes the lint rule possible.

One concept, one icon, everywhere. Before the registry existed, `HardDrive`
stood for both *Logs* and *Disk Images*, `FileText` for both *Vault* and *Case
Templates*, and `Shield` for both *CTI Lookup* and *Audit* — drift that was
invisible until someone looked at the sidebar.

Adding an icon: import and re-export it in the registry. If it names a
*concept* rather than a shape, check `NAV_ICON` and the existing exports first.
Stroke width is uniform; size comes from the token scale, not from an arbitrary
`size={17}`.

### Styling
`eslint` mirrors the ruff scope: defect rules only (`react-hooks`,
`no-unused-vars`, `no-useless-escape`), `--max-warnings 0`, blocking.
Formatting and the `any` cleanup are S12.

- Tailwind utilities only. No inline `style`, no CSS modules, no styled-components.
- **No literal colour anywhere outside the token file.** No `#0B121F`, no `rgb(...)`, no `bg-teal-400`. Use semantic tokens: `bg-surface-raised`, `text-primary`, `border-subtle`, `text-accent`.
- Spacing comes from the scale: 4 / 8 / 12 / 16 / 24 / 32. No `p-[13px]`.
- One elevation strategy per component: a border **or** a shadow, never both.
- Composite UI is built from the primitives (`Panel`, `DataTable`, `Toolbar`, `FilterChips`, `SidePanel`, `StatTile`, `EmptyState`). A hand-rolled table is a review rejection.

### Component size
A component over ~400 lines is split. The pre-S14 `ArtifactExplorer.tsx` at
2 599 lines is the standing counter-example, not a precedent.

### Forbidden in merged code
`console.log`, `debugger`, `any` without an adjacent comment justifying it,
commented-out code, `// TODO` without an issue number.

---

## 6. Data and time

- **Everything is stored in UTC.** No exception, no naive datetime in the database.
- Every artifact carries a **source timezone** recorded at ingestion (`INGESTION.md`), because exports mix local and UTC and the ambiguity is unrecoverable later.
- Display timezone is a user preference, applied at render only.
- Timestamps render as `yyyy-MM-dd HH:mm:ss` with an explicit zone suffix. Never a locale-dependent format.
- Hashes, paths, IPs, command lines and identifiers render in the monospace face.

---

## 7. Security

- Never execute anything from the drop folder outside the sandbox described in `INGESTION.md`: non-root, no network, wall-clock timeout, output quota.
- Never log a secret, a token, or a connector credential — not even truncated.
- Every case-scoped endpoint filters on the caller's client scope through a shared dependency, never through a per-router condition. A filter that can be forgotten will be forgotten.
- New third-party dependencies are justified in the PR description.
