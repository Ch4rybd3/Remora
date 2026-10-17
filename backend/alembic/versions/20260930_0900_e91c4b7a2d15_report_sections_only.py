"""one shape for report content: sections

A case carried three fixed columns - report_analysis, report_remediation,
report_conclusion - alongside `report_sections_data`, a slug-keyed JSON blob
holding one entry per section the case template declares. The Report tab chose
between them at render time depending on whether the template declared any
sections, so the same case could hold content in two shapes and the exporter
had four tags for the same material.

The sections won. They carry their own names, they survive a template being
renamed, and a report template can place them individually instead of taking
three buckets somebody else decided the boundaries of.

**This drops the three columns and their content.** Taken deliberately: no
instance is carrying a real case, which is the only reason a migration that
loses analyst-written text is acceptable. Had that not been true the right move
was to fold each column into a section of the same name first.

Revision ID: e91c4b7a2d15
Revises: d5a72e9c4418
Create Date: 2026-09-30 09:00:00.000000+00:00
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e91c4b7a2d15'
down_revision: Union[str, None] = 'd5a72e9c4418'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = ("report_analysis", "report_remediation", "report_conclusion")


def upgrade() -> None:
    with op.batch_alter_table("cases", schema=None) as batch_op:
        for column in _COLUMNS:
            batch_op.drop_column(column)


def downgrade() -> None:
    """Recreate the columns, empty. A drop is a drop."""
    with op.batch_alter_table("cases", schema=None) as batch_op:
        for column in _COLUMNS:
            batch_op.add_column(sa.Column(column, sa.Text(), nullable=True,
                                          server_default=""))
