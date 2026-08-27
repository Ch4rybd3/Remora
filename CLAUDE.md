# Remora — Development Standards

DFIR case management platform. Backend: FastAPI + SQLAlchemy + SQLite.
Frontend: React + TypeScript + TanStack Query + Tailwind.

This file is an index. The authoritative rules live in `docs/`.

## Read before contributing

| Document | Covers |
|---|---|
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | **Start here.** Language rule (English only), git and commit conventions, versioning, backend and frontend checklists, error handling, logging, styling and icon rules, time handling, security rules. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module layout, SQLAlchemy cascade behaviour, MITRE ATT&CK integration. |
| [docs/UI_PATTERNS.md](docs/UI_PATTERNS.md) | Timeline pinning, file-sidebar selection, default filter state. Behavioural contracts, not styling. |
| [docs/INGESTION.md](docs/INGESTION.md) | Artifact ingestion pipeline: drop folder, hashing, magic-byte identification, routing, deduplication, source timezone, storage, ECS normalisation, parser sandbox. |
| [docs/REPORT_TEMPLATES.md](docs/REPORT_TEMPLATES.md) | `{{ }}` tags available in DOCX and Markdown report templates. |
| [docs/DESIGN_BRIEF.md](docs/DESIGN_BRIEF.md) | Design tokens, identity constraints, theme requirements. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Sprint plan and locked architectural decisions. |

## The five rules that are never relaxed

1. **English only in source.** Code, comments, UI strings, errors, commits. Enforced in CI. User data and templates are exempt.
2. **A model change ships with its Alembic migration**, in the same pull request. Enforced in CI.
3. **No literal colour outside the token file.** Semantic CSS variables only, so every theme keeps working.
4. **One icon per concept**, imported from `frontend/src/ui/icons.ts`. Never from `lucide-react` directly.
5. **All timestamps are stored in UTC**, with the artifact's source timezone recorded at ingestion.
