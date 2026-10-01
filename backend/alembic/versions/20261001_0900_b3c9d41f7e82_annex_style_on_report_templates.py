"""Record which annex design a report template resolves to

The annex tables of a DOCX report template now take a table style named
`Remora Annex` when the document defines one. A convention with a silent
fallback needs to say out loud which branch it took, or a typo in the style
name looks like the feature not working.

Revision ID: b3c9d41f7e82
Revises: e91c4b7a2d15
Create Date: 2026-10-01

"""
from alembic import op
import sqlalchemy as sa

revision      = "b3c9d41f7e82"
down_revision = "e91c4b7a2d15"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.add_column("report_doc_templates",
                  sa.Column("annex_style", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("report_doc_templates", "annex_style")
