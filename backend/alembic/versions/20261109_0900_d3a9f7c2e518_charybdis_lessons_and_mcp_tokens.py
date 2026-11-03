"""Charybdis — lessons learned and MCP tokens

`agent_lessons` keeps what closed cases taught, readable by later
investigations within the client scope. `agent_mcp_tokens` holds the hashed
personal tokens MCP clients read cases with (docs/CHARYBDIS_FEATURES.md, S35).

Revision ID: d3a9f7c2e518
Revises: c8f4a1e6b293
Create Date: 2026-11-09

"""
from alembic import op
import sqlalchemy as sa

revision      = "d3a9f7c2e518"
down_revision = "c8f4a1e6b293"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "agent_lessons",
        sa.Column("id",          sa.String(),    primary_key=True),
        sa.Column("case_id",     sa.String(),    nullable=True),
        sa.Column("case_title",  sa.String(255), nullable=False),
        sa.Column("client_id",   sa.String(),    nullable=True),
        sa.Column("title",       sa.String(255), nullable=False),
        sa.Column("lesson",      sa.Text(),      nullable=False),
        sa.Column("tags",        sa.String(255), nullable=False),
        sa.Column("drafted_by",  sa.String(255), nullable=False),
        sa.Column("accepted_by", sa.String(255), nullable=False),
        sa.Column("created_at",  sa.DateTime(),  nullable=False),
    )
    op.create_index("ix_agent_lessons_case_id", "agent_lessons", ["case_id"])

    op.create_table(
        "agent_mcp_tokens",
        sa.Column("id",           sa.String(),    primary_key=True),
        sa.Column("user_id",      sa.String(),    sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name",         sa.String(128), nullable=False),
        sa.Column("token_hash",   sa.String(64),  nullable=False, unique=True),
        sa.Column("prefix",       sa.String(16),  nullable=False),
        sa.Column("created_at",   sa.DateTime(),  nullable=False),
        sa.Column("last_used_at", sa.DateTime(),  nullable=True),
        sa.Column("revoked_at",   sa.DateTime(),  nullable=True),
    )
    op.create_index("ix_agent_mcp_tokens_user_id", "agent_mcp_tokens", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_mcp_tokens_user_id", table_name="agent_mcp_tokens")
    op.drop_table("agent_mcp_tokens")
    op.drop_index("ix_agent_lessons_case_id", table_name="agent_lessons")
    op.drop_table("agent_lessons")
