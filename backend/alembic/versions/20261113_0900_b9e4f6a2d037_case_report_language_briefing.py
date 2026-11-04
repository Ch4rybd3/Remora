"""Cases — report language and executive briefing

`cases.report_language` is the language the report and the briefing are
written in; `cases.briefing` (with when and by whom) the plain-language status
an executive reads (docs/CHARYBDIS_FEATURES.md, S40).

Revision ID: b9e4f6a2d037
Revises: a8d3e5f1c926
Create Date: 2026-11-13

"""
from alembic import op
import sqlalchemy as sa

revision      = "b9e4f6a2d037"
down_revision = "a8d3e5f1c926"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    with op.batch_alter_table("cases") as batch:
        batch.add_column(sa.Column("report_language", sa.String(8), nullable=False, server_default="en"))
        batch.add_column(sa.Column("briefing", sa.Text(), nullable=False, server_default=""))
        batch.add_column(sa.Column("briefing_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("briefing_by", sa.String(255), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("cases") as batch:
        batch.drop_column("briefing_by")
        batch.drop_column("briefing_at")
        batch.drop_column("briefing")
        batch.drop_column("report_language")
