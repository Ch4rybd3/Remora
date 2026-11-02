"""Charybdis — observations and findings

`agent_observations` holds the artifact rows agents cite, each with the RQL
that selects it and a copy of the row. `agent_findings` holds conclusions that
rest on observations, with the reviewer's verdict and the analyst's decision
(docs/CHARYBDIS_FEATURES.md, S32).

Revision ID: e4c9a2b7d815
Revises: d8b3f6a1c274
Create Date: 2026-11-04

"""
from alembic import op
import sqlalchemy as sa

revision      = "e4c9a2b7d815"
down_revision = "d8b3f6a1c274"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "agent_observations",
        sa.Column("id",             sa.String(),    primary_key=True),
        sa.Column("case_id",        sa.String(),    sa.ForeignKey("cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_id",       sa.String(),    sa.ForeignKey("agent_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id",        sa.String(),    sa.ForeignKey("agent_tasks.id", ondelete="SET NULL",
                                                                  name="fk_agent_observations_task_id"), nullable=True),
        sa.Column("artifact_id",    sa.String(),    nullable=False),
        sa.Column("artifact_name",  sa.String(255), nullable=False),
        sa.Column("artifact_label", sa.String(100), nullable=True),
        sa.Column("locator",        sa.Text(),      nullable=False),
        sa.Column("row",            sa.Text(),      nullable=False),
        sa.Column("note",           sa.Text(),      nullable=False),
        sa.Column("created_at",     sa.DateTime(),  nullable=False),
    )
    op.create_index("ix_agent_observations_case_id", "agent_observations", ["case_id"])

    op.create_table(
        "agent_findings",
        sa.Column("id",                  sa.String(),    primary_key=True),
        sa.Column("case_id",             sa.String(),    sa.ForeignKey("cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_id",            sa.String(),    sa.ForeignKey("agent_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id",             sa.String(),    sa.ForeignKey("agent_tasks.id", ondelete="SET NULL",
                                                                       name="fk_agent_findings_task_id"), nullable=True),
        sa.Column("ref",                 sa.Integer(),   nullable=False),
        sa.Column("title",               sa.String(255), nullable=False),
        sa.Column("statement",           sa.Text(),      nullable=False),
        sa.Column("severity",            sa.String(16),  nullable=False),
        sa.Column("confidence",          sa.String(16),  nullable=False),
        sa.Column("confidence_reason",   sa.Text(),      nullable=False),
        sa.Column("attack_ids",          sa.Text(),      nullable=False),
        sa.Column("observation_ids",     sa.Text(),      nullable=False),
        sa.Column("state",               sa.String(16),  nullable=False),
        sa.Column("review_task_id",      sa.String(),    sa.ForeignKey("agent_tasks.id", ondelete="SET NULL",
                                                                       name="fk_agent_findings_review_task_id"), nullable=True),
        sa.Column("review_verdict",      sa.String(16),  nullable=True),
        sa.Column("review_comment",      sa.Text(),      nullable=True),
        sa.Column("review_alternatives", sa.Text(),      nullable=True),
        sa.Column("reviewed_by",         sa.String(128), nullable=True),
        sa.Column("decided_by",          sa.String(255), nullable=True),
        sa.Column("decided_at",          sa.DateTime(),  nullable=True),
        sa.Column("decision_comment",    sa.Text(),      nullable=True),
        sa.Column("created_at",          sa.DateTime(),  nullable=False),
    )
    op.create_index("ix_agent_findings_case_state", "agent_findings", ["case_id", "state"])
    op.create_index("ix_agent_findings_case_ref", "agent_findings", ["case_id", "ref"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_agent_findings_case_ref", table_name="agent_findings")
    op.drop_index("ix_agent_findings_case_state", table_name="agent_findings")
    op.drop_table("agent_findings")
    op.drop_index("ix_agent_observations_case_id", table_name="agent_observations")
    op.drop_table("agent_observations")
