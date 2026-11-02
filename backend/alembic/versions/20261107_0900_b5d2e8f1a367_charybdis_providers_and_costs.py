"""Charybdis — model providers, model per role, and cost per task

`agent_providers` holds the providers an administrator configures beside the
built-in Ollama, with their API key encrypted at rest and their prices.
`agent_role_models` sets the provider and model each role is staffed with.
`agent_tasks.cost_usd` is what a task's model calls cost
(docs/CHARYBDIS_FEATURES.md, S34).

Revision ID: b5d2e8f1a367
Revises: a7e3c1d9f450
Create Date: 2026-11-07

"""
from alembic import op
import sqlalchemy as sa

revision      = "b5d2e8f1a367"
down_revision = "a7e3c1d9f450"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "agent_providers",
        sa.Column("id",            sa.String(),    primary_key=True),
        sa.Column("name",          sa.String(64),  nullable=False, unique=True),
        sa.Column("kind",          sa.String(16),  nullable=False),
        sa.Column("base_url",      sa.String(512), nullable=False),
        sa.Column("locality",      sa.String(8),   nullable=False),
        sa.Column("api_key_enc",   sa.Text(),      nullable=True),
        sa.Column("api_key_salt",  sa.String(64),  nullable=True),
        sa.Column("api_key_hint",  sa.String(8),   nullable=True),
        sa.Column("default_model", sa.String(128), nullable=False),
        sa.Column("input_price",   sa.Float(),     nullable=False),
        sa.Column("output_price",  sa.Float(),     nullable=False),
        sa.Column("enabled",       sa.Boolean(),   nullable=False),
        sa.Column("updated_by",    sa.String(255), nullable=False),
        sa.Column("created_at",    sa.DateTime(),  nullable=False),
        sa.Column("updated_at",    sa.DateTime(),  nullable=False),
    )
    op.create_table(
        "agent_role_models",
        sa.Column("role",       sa.String(64),  primary_key=True),
        sa.Column("provider",   sa.String(64),  nullable=False),
        sa.Column("model",      sa.String(128), nullable=False),
        sa.Column("updated_by", sa.String(255), nullable=False),
        sa.Column("updated_at", sa.DateTime(),  nullable=False),
    )
    with op.batch_alter_table("agent_tasks") as batch:
        batch.add_column(sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("agent_tasks") as batch:
        batch.drop_column("cost_usd")
    op.drop_table("agent_role_models")
    op.drop_table("agent_providers")
