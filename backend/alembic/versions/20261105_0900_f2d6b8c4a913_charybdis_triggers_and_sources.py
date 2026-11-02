"""Charybdis — ingestion triggers and observation sources

`agent_ingest_notices` records which ingested files the Incident Leader was
told about. `agent_observations.source_kind` says whether a cited row comes
from an Explorer table or from a memory dump, an email or a binary
(docs/CHARYBDIS_FEATURES.md, S33).

Revision ID: f2d6b8c4a913
Revises: e4c9a2b7d815
Create Date: 2026-11-05

"""
from alembic import op
import sqlalchemy as sa

revision      = "f2d6b8c4a913"
down_revision = "e4c9a2b7d815"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    with op.batch_alter_table("agent_observations") as batch:
        batch.add_column(sa.Column("source_kind", sa.String(16), nullable=False,
                                   server_default="artifact"))

    op.create_table(
        "agent_ingest_notices",
        sa.Column("id",               sa.String(),   primary_key=True),
        sa.Column("case_id",          sa.String(),   sa.ForeignKey("cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ingested_file_id", sa.String(),   sa.ForeignKey("ingested_files.id", ondelete="CASCADE"),
                  nullable=False, unique=True),
        sa.Column("task_id",          sa.String(),   sa.ForeignKey("agent_tasks.id", ondelete="SET NULL",
                                                                   name="fk_agent_ingest_notices_task_id"), nullable=True),
        sa.Column("created_at",       sa.DateTime(), nullable=False),
    )
    op.create_index("ix_agent_ingest_notices_case_id", "agent_ingest_notices", ["case_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_ingest_notices_case_id", table_name="agent_ingest_notices")
    op.drop_table("agent_ingest_notices")
    with op.batch_alter_table("agent_observations") as batch:
        batch.drop_column("source_kind")
