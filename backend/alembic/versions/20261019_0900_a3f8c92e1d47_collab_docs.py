"""Collaborative editing — persisted Yjs document state per room

Adds `collab_docs` table. Each row stores the binary Y.Doc update for one
collaborative editing room (a playbook step note or a case's quick notes).
The binary state is applied on top of an empty Doc on room creation to
restore the document as it was when last saved.

Revision ID: a3f8c92e1d47
Revises: f4b2e71c9a30
Create Date: 2026-10-19

"""
from alembic import op
import sqlalchemy as sa

revision      = "a3f8c92e1d47"
down_revision = "f4b2e71c9a30"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "collab_docs",
        sa.Column("id",         sa.String(),       primary_key=True),
        sa.Column("room_id",    sa.String(255),    nullable=False),
        sa.Column("ydoc_state", sa.LargeBinary(),  nullable=False, server_default=sa.text("''")),
        sa.Column("updated_at", sa.DateTime(),     nullable=True),
    )
    op.create_index("ix_collab_docs_room_id", "collab_docs", ["room_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_collab_docs_room_id", table_name="collab_docs")
    op.drop_table("collab_docs")
