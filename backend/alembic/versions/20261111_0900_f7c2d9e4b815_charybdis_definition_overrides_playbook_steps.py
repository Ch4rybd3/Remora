"""Charybdis — edited definitions and playbook steps given to agents

`agent_definition_overrides` holds the roles, processes and prompts an
administrator wrote or changed in the interface, over the files of
`templates/agents/`; `agent_tasks.playbook_step` links a task to the playbook
step it was assigned from (docs/CHARYBDIS_FEATURES.md, S38).

Revision ID: f7c2d9e4b815
Revises: e6b1c4d8a702
Create Date: 2026-11-11

"""
from alembic import op
import sqlalchemy as sa

revision      = "f7c2d9e4b815"
down_revision = "e6b1c4d8a702"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "agent_definition_overrides",
        sa.Column("id",         sa.String(),    primary_key=True),
        sa.Column("kind",       sa.String(16),  nullable=False),
        sa.Column("name",       sa.String(128), nullable=False),
        sa.Column("content",    sa.Text(),      nullable=False),
        sa.Column("updated_by", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(),  nullable=False),
        sa.Column("updated_at", sa.DateTime(),  nullable=False),
        sa.UniqueConstraint("kind", "name", name="uq_agent_definition_overrides_kind_name"),
    )
    with op.batch_alter_table("agent_tasks") as batch:
        batch.add_column(sa.Column("playbook_step", sa.String(160), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("agent_tasks") as batch:
        batch.drop_column("playbook_step")
    op.drop_table("agent_definition_overrides")
