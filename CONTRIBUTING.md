# Contributing to Remora

The binding rules live in [docs/CONVENTIONS.md](docs/CONVENTIONS.md). This page
is the short version: how to get set up and how a change reaches production.

## Setup

```bash
git clone https://github.com/Ch4rybd3/Remora.git
cd Remora
cp .env.example .env          # set SECRET_KEY at minimum
docker compose up -d
```

Backend on `:8000`, frontend on `:80`. First start creates an `admin` account
with the password from `DEFAULT_ADMIN_PASSWORD`.

### Running the checks locally

```bash
# Backend
pip install -r backend/requirements-dev.txt
ruff check backend/
mypy
SECRET_KEY=dev SKIP_TOOL_SETUP=true pytest backend/tests

# Frontend
cd frontend && npm ci
npm run lint && npm run typecheck && npm test && npm run build
```

`SKIP_TOOL_SETUP=true` skips downloading Chainsaw and the CTI tooling. Leave it
set unless you are working on that provisioning.

## How a change ships

```
feat/my-change ──squash──> integration ──merge──> main ──> tag + release notes
```

1. Branch from `integration`: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`.
2. One concern per branch. A change that renames things *and* changes behaviour gets split.
3. Open a pull request against `integration`. **The pull request title is the commit message** — squash-merge collapses the branch into it — so it must be a valid Conventional Commit.
4. Green CI is required. Never merge through a red check.
5. `integration` is merged into `main` when a release is cut. That merge is a merge commit, not a squash: it is what feeds the release notes.

### Commit format

```
feat(ingest): route EVTX by magic bytes
fix(explorer): keep column filters across pagination
docs(conventions): document the icon registry
```

Types: `feat` `fix` `chore` `docs` `refactor` `perf` `test` `build` `ci`.
Scope is the module. `feat` bumps the minor, `fix` the patch, a `!` or a
`BREAKING CHANGE:` footer the major.

These messages become the public changelog. A lazy commit message becomes a
lazy release note.

## Rules that CI enforces

| Rule | Check |
|---|---|
| New source is English | Lines added by the pull request must not contain accented characters. Pre-existing French is being converted in S12; do not add more. |
| Model changes ship a migration | Enforced by `test_models_match_the_migrated_schema`, which compares the live schema against the models. Editing a model file without changing the schema is fine; changing the schema without a revision fails the backend job. |
| No debug statements | No `console.log`, `console.debug` or `debugger` in `frontend/src`. |
| Lint, types, tests, build | ruff, mypy, pytest, eslint, tsc, vitest, `vite build`, and the backend Docker image. |

### Adding a model

```bash
# 1. edit backend/app/models/<feature>.py
# 2. generate the revision — in the same commit
cd backend
alembic revision --autogenerate -m "add source_timezone to ingested_files"
# 3. read the generated file before committing it
```

Autogenerate is a starting point, not an oracle. Read what it produced. Prefer
`op.add_column` with a server default over anything that rewrites a table, and
never write a `DROP` that discards analyst data without an explicit decision.

### The mypy ratchet

61 of 102 backend modules are type-checked; the rest are exempted by name in
`pyproject.toml`. A module may be **removed** from that list once it is clean.
Nothing may be **added** to it.

## Releases

`release-please` keeps an open release pull request against `main`. Merging it
tags the commit, updates `CHANGELOG.md` and publishes the GitHub release.

Never tag by hand, and never edit `version.txt`, `backend/app/__version__.py`
or the version in `frontend/package.json` — release-please owns all three.

> The first release cut from `main` will be proposed as `0.2.0`, because the
> foundation work carries `feat` commits. To publish it as `0.1.0` instead, put
> `Release-As: 0.1.0` in the footer of the `integration → main` merge commit.

## Reporting a security issue

See [SECURITY.md](SECURITY.md). Do not open a public issue.
