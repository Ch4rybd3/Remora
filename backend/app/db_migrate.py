"""
Schema migration runner, executed once at application startup.

Replaces `Base.metadata.create_all()`, which only ever created *missing tables*
and silently ignored missing *columns* — so every model change shipped to an
existing installation either crashed it or left it on a stale schema.

Three cases are handled:

* **Fresh database** — no tables at all. Alembic runs every revision from the
  baseline, which is equivalent to what create_all() used to do.
* **Pre-Alembic database** — created by a Remora older than 0.1.0. It already
  matches the baseline (the old startup ALTER statements were idempotent and
  ran on every boot), so it is stamped with the baseline and then upgraded.
* **Managed database** — has `alembic_version`. Upgraded to head.

Adoption is automatic and needs no operator action, which matters because the
alternative is asking every existing installation to run a manual command
before it can start.
"""
from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect

from alembic import command

from .database import engine

# backend/ — alembic.ini and alembic/ live next to the app package
_BACKEND_DIR = Path(__file__).resolve().parent.parent

# Presence of this table means the database predates Alembic but is otherwise
# a real Remora database. `users` is created by the very first revision and is
# never dropped.
_SENTINEL_TABLE = "users"


def _alembic_config() -> Config:
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "alembic"))
    return cfg


def _baseline_revision(cfg: Config) -> str:
    """The revision with no parent — the schema every old database already has."""
    script = ScriptDirectory.from_config(cfg)
    for revision in script.walk_revisions():
        if revision.down_revision is None:
            return revision.revision
    raise RuntimeError("No baseline revision found in alembic/versions")


def run_migrations() -> None:
    cfg = _alembic_config()
    tables = set(inspect(engine).get_table_names())

    if "alembic_version" not in tables and _SENTINEL_TABLE in tables:
        baseline = _baseline_revision(cfg)
        print(
            f"[migration] pre-Alembic database detected — stamping baseline {baseline}",
            flush=True,
        )
        command.stamp(cfg, baseline)

    command.upgrade(cfg, "head")
    print("[migration] schema is at head", flush=True)
