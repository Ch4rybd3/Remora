"""
Alembic environment for Remora.

Two things make this file worth reading:

1. The database URL comes from `app.config.settings`, never from alembic.ini,
   so the CLI and the running application can never disagree about which
   database they are talking to.

2. Every module under `app.models` is imported dynamically before autogenerate
   runs. A hand-maintained import list is the classic way to silently lose a
   table from a migration — adding a model file is enough here.
"""
from __future__ import annotations

import pkgutil
from importlib import import_module
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import settings
from app.database import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", settings.database_url)


def _import_all_models() -> None:
    """Import every module in app.models so Base.metadata is complete."""
    package = import_module("app.models")
    for module in pkgutil.iter_modules(package.__path__):
        if not module.name.startswith("_"):
            import_module(f"app.models.{module.name}")


_import_all_models()
target_metadata = Base.metadata


def _include_object(obj, name, type_, reflected, compare_to) -> bool:
    """Keep autogenerate out of tables Remora does not own."""
    if type_ == "table" and name in {"alembic_version", "sqlite_sequence"}:
        return False
    return True


# SQLite cannot ALTER a column in place. Batch mode makes Alembic rebuild the
# table instead, which is the only way column changes work on the default
# deployment. It is harmless on other backends.
_COMMON = dict(
    target_metadata=target_metadata,
    include_object=_include_object,
    render_as_batch=True,
    compare_type=True,
    compare_server_default=True,
)


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        **_COMMON,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, **_COMMON)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
