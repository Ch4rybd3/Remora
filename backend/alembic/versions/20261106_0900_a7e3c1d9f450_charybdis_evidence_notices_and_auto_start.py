"""Charybdis — evidence notices and the leader's auto-start

S33 told the Incident Leader about `ingested_files` rows only, and files
uploaded straight into the Explorer or the email, memory and binary pages
never made one. `agent_evidence_notices` keys a notice on what agents can read
instead: a table, an email, a memory dump or a binary. `agent_ingest_notices`
is dropped; its rows only said which files had been announced.

`agent_instances.auto_start` lets the analyst have the leader's proposed tasks
start without approval, per case (docs/CHARYBDIS_FEATURES.md, S34).

Revision ID: a7e3c1d9f450
Revises: f2d6b8c4a913
Create Date: 2026-11-06

"""
from alembic import op
import sqlalchemy as sa

revision      = "a7e3c1d9f450"
down_revision = "f2d6b8c4a913"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.drop_index("ix_agent_ingest_notices_case_id", table_name="agent_ingest_notices")
    op.drop_table("agent_ingest_notices")

    op.create_table(
        "agent_evidence_notices",
        sa.Column("id",          sa.String(),   primary_key=True),
        sa.Column("case_id",     sa.String(),   sa.ForeignKey("cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_kind", sa.String(16), nullable=False),
        sa.Column("source_id",   sa.String(),   nullable=False),
        sa.Column("task_id",     sa.String(),   sa.ForeignKey("agent_tasks.id", ondelete="SET NULL",
                                                              name="fk_agent_evidence_notices_task_id"), nullable=True),
        sa.Column("created_at",  sa.DateTime(), nullable=False),
        sa.UniqueConstraint("source_kind", "source_id", name="uq_agent_evidence_notices_source"),
    )
    op.create_index("ix_agent_evidence_notices_case_id", "agent_evidence_notices", ["case_id"])

    with op.batch_alter_table("agent_instances") as batch:
        batch.add_column(sa.Column("auto_start", sa.Boolean(), nullable=False,
                                   server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table("agent_instances") as batch:
        batch.drop_column("auto_start")

    op.drop_index("ix_agent_evidence_notices_case_id", table_name="agent_evidence_notices")
    op.drop_table("agent_evidence_notices")

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
