"""
Migration integrity.

The failure this guards against: a model gains a column, no migration is
written, CI stays green, and the change reaches an installation whose database
does not have that column. The check is mechanical — compare the live schema
against the models and require no difference.
"""
from __future__ import annotations

import pkgutil
from importlib import import_module

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect

from app.database import Base, engine


def _import_all_models() -> None:
    package = import_module("app.models")
    for module in pkgutil.iter_modules(package.__path__):
        if not module.name.startswith("_"):
            import_module(f"app.models.{module.name}")


def test_models_match_the_migrated_schema(client) -> None:
    """Fails when a model was changed without an accompanying revision.

    `client` is requested so startup — and therefore the migration runner — has
    already brought the test database to head.
    """
    _import_all_models()
    with engine.connect() as connection:
        context = MigrationContext.configure(connection)
        diff = compare_metadata(context, Base.metadata)

    assert not diff, (
        "The models no longer match the migrations. Run:\n"
        "    cd backend && alembic revision --autogenerate -m \"<what changed>\"\n"
        "and commit the generated revision.\n\n"
        f"Detected differences: {diff}"
    )


def test_schema_is_stamped(client) -> None:
    tables = set(inspect(engine).get_table_names())
    assert "alembic_version" in tables, "migrations did not run at startup"
    assert "users" in tables, "baseline revision did not create the core tables"
