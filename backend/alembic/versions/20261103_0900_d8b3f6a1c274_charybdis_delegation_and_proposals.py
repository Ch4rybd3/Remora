"""Charybdis — delegated tasks and the proposals inbox

`agent_tasks` gains what delegation needs: why the task exists, which process
it follows and where it is in it, the task it was spawned from, the tasks it
waits for, and the report it ended with. `agent_proposals` holds what agents
want written into the case until the analyst decides (docs/CHARYBDIS.md P1).

Revision ID: d8b3f6a1c274
Revises: c1a7e5d2b940
Create Date: 2026-11-03

"""
from alembic import op
import sqlalchemy as sa

revision      = "d8b3f6a1c274"
down_revision = "c1a7e5d2b940"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    with op.batch_alter_table("agent_tasks") as batch:
        batch.add_column(sa.Column("kind", sa.String(16), nullable=False, server_default="message"))
        batch.add_column(sa.Column("process_id", sa.String(64), nullable=True))
        batch.add_column(sa.Column("current_step", sa.String(64), nullable=True))
        batch.add_column(sa.Column("parent_task_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("depends_on", sa.Text(), nullable=False, server_default="[]"))
        batch.add_column(sa.Column("report", sa.Text(), nullable=True))
        batch.create_foreign_key(
            "fk_agent_tasks_parent_task_id", "agent_tasks",
            ["parent_task_id"], ["id"], ondelete="SET NULL",
        )

    op.create_table(
        "agent_proposals",
        sa.Column("id",               sa.String(),    primary_key=True),
        sa.Column("case_id",          sa.String(),    sa.ForeignKey("cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_id",         sa.String(),    sa.ForeignKey("agent_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id",          sa.String(),    sa.ForeignKey("agent_tasks.id", ondelete="SET NULL",
                                                                    name="fk_agent_proposals_task_id"), nullable=True),
        sa.Column("kind",             sa.String(32),  nullable=False),
        sa.Column("payload",          sa.Text(),      nullable=False),
        sa.Column("rationale",        sa.Text(),      nullable=False),
        sa.Column("evidence",         sa.Text(),      nullable=False),
        sa.Column("state",            sa.String(16),  nullable=False),
        sa.Column("decided_by",       sa.String(255), nullable=True),
        sa.Column("decided_at",       sa.DateTime(),  nullable=True),
        sa.Column("decision_comment", sa.Text(),      nullable=True),
        sa.Column("result_id",        sa.String(),    nullable=True),
        sa.Column("created_at",       sa.DateTime(),  nullable=False),
    )
    op.create_index("ix_agent_proposals_case_state", "agent_proposals", ["case_id", "state"])


def downgrade() -> None:
    op.drop_index("ix_agent_proposals_case_state", table_name="agent_proposals")
    op.drop_table("agent_proposals")

    with op.batch_alter_table("agent_tasks") as batch:
        batch.drop_constraint("fk_agent_tasks_parent_task_id", type_="foreignkey")
        for column in ("report", "depends_on", "parent_task_id", "current_step",
                       "process_id", "kind"):
            batch.drop_column(column)
