"""Charybdis — agent instances, tasks and the event trace

Adds `agent_instances`, `agent_tasks` and `agent_events`. Every table is
prefixed `agent_` so the module is removed by this one downgrade
(docs/CHARYBDIS.md section 1).

Revision ID: c1a7e5d2b940
Revises: a3f8c92e1d47
Create Date: 2026-11-02

"""
from alembic import op
import sqlalchemy as sa

revision      = "c1a7e5d2b940"
down_revision = "a3f8c92e1d47"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "agent_instances",
        sa.Column("id",          sa.String(),      primary_key=True),
        sa.Column("case_id",     sa.String(),      sa.ForeignKey("cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role",        sa.String(64),    nullable=False),
        sa.Column("name",        sa.String(128),   nullable=False),
        sa.Column("provider",    sa.String(32),    nullable=False),
        sa.Column("model",       sa.String(128),   nullable=False),
        sa.Column("status",      sa.String(16),    nullable=False),
        sa.Column("launched_by", sa.String(255),   nullable=False),
        sa.Column("created_at",  sa.DateTime(),    nullable=False),
        sa.Column("updated_at",  sa.DateTime(),    nullable=False),
    )
    op.create_index("ix_agent_instances_case_id", "agent_instances", ["case_id"])

    op.create_table(
        "agent_tasks",
        sa.Column("id",              sa.String(),   primary_key=True),
        sa.Column("case_id",         sa.String(),   sa.ForeignKey("cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_id",        sa.String(),   sa.ForeignKey("agent_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("objective",       sa.Text(),     nullable=False),
        sa.Column("status",          sa.String(16), nullable=False),
        sa.Column("requested_by_id", sa.String(),   sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("max_steps",       sa.Integer(),  nullable=False),
        sa.Column("steps_used",      sa.Integer(),  nullable=False),
        sa.Column("tokens_in",       sa.Integer(),  nullable=False),
        sa.Column("tokens_out",      sa.Integer(),  nullable=False),
        sa.Column("error",           sa.Text(),     nullable=True),
        sa.Column("created_at",      sa.DateTime(), nullable=False),
        sa.Column("started_at",      sa.DateTime(), nullable=True),
        sa.Column("finished_at",     sa.DateTime(), nullable=True),
    )
    op.create_index("ix_agent_tasks_agent_id", "agent_tasks", ["agent_id"])
    op.create_index("ix_agent_tasks_case_status", "agent_tasks", ["case_id", "status"])

    op.create_table(
        "agent_events",
        sa.Column("id",         sa.String(),    primary_key=True),
        sa.Column("case_id",    sa.String(),    sa.ForeignKey("cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_id",   sa.String(),    sa.ForeignKey("agent_instances.id", ondelete="CASCADE"), nullable=True),
        sa.Column("task_id",    sa.String(),    sa.ForeignKey("agent_tasks.id", ondelete="CASCADE"), nullable=True),
        sa.Column("seq",        sa.Integer(),   nullable=False),
        sa.Column("kind",       sa.String(32),  nullable=False),
        sa.Column("payload",    sa.Text(),      nullable=False),
        sa.Column("actor",      sa.String(255), nullable=False),
        sa.Column("prev_hash",  sa.String(64),  nullable=False),
        sa.Column("hash",       sa.String(64),  nullable=False),
        sa.Column("created_at", sa.DateTime(),  nullable=False),
    )
    op.create_index("ix_agent_events_agent_id", "agent_events", ["agent_id"])
    op.create_index("ix_agent_events_task_id", "agent_events", ["task_id"])
    op.create_index("ix_agent_events_case_seq", "agent_events", ["case_id", "seq"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_agent_events_case_seq", table_name="agent_events")
    op.drop_index("ix_agent_events_task_id", table_name="agent_events")
    op.drop_index("ix_agent_events_agent_id", table_name="agent_events")
    op.drop_table("agent_events")
    op.drop_index("ix_agent_tasks_case_status", table_name="agent_tasks")
    op.drop_index("ix_agent_tasks_agent_id", table_name="agent_tasks")
    op.drop_table("agent_tasks")
    op.drop_index("ix_agent_instances_case_id", table_name="agent_instances")
    op.drop_table("agent_instances")
