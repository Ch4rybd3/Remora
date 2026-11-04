"""Charybdis — collection requests and case phases

`agent_collection_requests` holds the evidence an agent found missing and the
analyst agreed to ask for, per host; `cases.phase` the phase of the response
the case is in (docs/CHARYBDIS_FEATURES.md, S39).

Revision ID: a8d3e5f1c926
Revises: f7c2d9e4b815
Create Date: 2026-11-12

"""
from alembic import op
import sqlalchemy as sa

revision      = "a8d3e5f1c926"
down_revision = "f7c2d9e4b815"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "agent_collection_requests",
        sa.Column("id",           sa.String(),    primary_key=True),
        sa.Column("case_id",      sa.String(),    sa.ForeignKey("cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("host",         sa.String(255), nullable=False),
        sa.Column("artifact",     sa.String(64),  nullable=False),
        sa.Column("reason",       sa.Text(),      nullable=False),
        sa.Column("hypothesis",   sa.String(16),  nullable=True),
        sa.Column("state",        sa.String(16),  nullable=False),
        sa.Column("note",         sa.Text(),      nullable=False),
        sa.Column("requested_by", sa.String(255), nullable=False),
        sa.Column("accepted_by",  sa.String(255), nullable=False),
        sa.Column("created_at",   sa.DateTime(),  nullable=False),
        sa.Column("updated_at",   sa.DateTime(),  nullable=False),
    )
    op.create_index("ix_agent_collection_requests_case_id", "agent_collection_requests", ["case_id"])
    with op.batch_alter_table("cases") as batch:
        batch.add_column(sa.Column("phase", sa.String(16), nullable=False, server_default="identification"))


def downgrade() -> None:
    with op.batch_alter_table("cases") as batch:
        batch.drop_column("phase")
    op.drop_index("ix_agent_collection_requests_case_id", table_name="agent_collection_requests")
    op.drop_table("agent_collection_requests")
