"""Charybdis — approvals, MCP servers and detection rules

`agent_approvals` holds actions that send something out of Remora until the
analyst decides; `agent_mcp_servers` the third-party MCP servers agents may
call; `agent_detection_rules` the Sigma and YARA rules accepted from agents
(docs/CHARYBDIS_FEATURES.md, S37).

Revision ID: e6b1c4d8a702
Revises: d3a9f7c2e518
Create Date: 2026-11-10

"""
from alembic import op
import sqlalchemy as sa

revision      = "e6b1c4d8a702"
down_revision = "d3a9f7c2e518"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "agent_approvals",
        sa.Column("id",               sa.String(),    primary_key=True),
        sa.Column("case_id",          sa.String(),    sa.ForeignKey("cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_id",         sa.String(),    sa.ForeignKey("agent_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id",          sa.String(),    sa.ForeignKey("agent_tasks.id", ondelete="SET NULL",
                                                                    name="fk_agent_approvals_task_id"), nullable=True),
        sa.Column("tool",             sa.String(64),  nullable=False),
        sa.Column("arguments",        sa.Text(),      nullable=False),
        sa.Column("summary",          sa.Text(),      nullable=False),
        sa.Column("state",            sa.String(16),  nullable=False),
        sa.Column("decided_by",       sa.String(255), nullable=True),
        sa.Column("decided_at",       sa.DateTime(),  nullable=True),
        sa.Column("decision_comment", sa.Text(),      nullable=True),
        sa.Column("result",           sa.Text(),      nullable=True),
        sa.Column("created_at",       sa.DateTime(),  nullable=False),
    )
    op.create_index("ix_agent_approvals_case_id", "agent_approvals", ["case_id"])

    op.create_table(
        "agent_mcp_servers",
        sa.Column("id",          sa.String(),    primary_key=True),
        sa.Column("name",        sa.String(64),  nullable=False, unique=True),
        sa.Column("url",         sa.String(512), nullable=False),
        sa.Column("locality",    sa.String(8),   nullable=False),
        sa.Column("auth_enc",    sa.Text(),      nullable=True),
        sa.Column("auth_salt",   sa.String(64),  nullable=True),
        sa.Column("description", sa.Text(),      nullable=False),
        sa.Column("enabled",     sa.Boolean(),   nullable=False),
        sa.Column("updated_by",  sa.String(255), nullable=False),
        sa.Column("created_at",  sa.DateTime(),  nullable=False),
        sa.Column("updated_at",  sa.DateTime(),  nullable=False),
    )

    op.create_table(
        "agent_detection_rules",
        sa.Column("id",          sa.String(),    primary_key=True),
        sa.Column("case_id",     sa.String(),    nullable=True),
        sa.Column("case_title",  sa.String(255), nullable=False),
        sa.Column("kind",        sa.String(8),   nullable=False),
        sa.Column("title",       sa.String(255), nullable=False),
        sa.Column("content",     sa.Text(),      nullable=False),
        sa.Column("findings",    sa.Text(),      nullable=False),
        sa.Column("drafted_by",  sa.String(255), nullable=False),
        sa.Column("accepted_by", sa.String(255), nullable=False),
        sa.Column("created_at",  sa.DateTime(),  nullable=False),
    )
    op.create_index("ix_agent_detection_rules_case_id", "agent_detection_rules", ["case_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_detection_rules_case_id", table_name="agent_detection_rules")
    op.drop_table("agent_detection_rules")
    op.drop_table("agent_mcp_servers")
    op.drop_index("ix_agent_approvals_case_id", table_name="agent_approvals")
    op.drop_table("agent_approvals")
