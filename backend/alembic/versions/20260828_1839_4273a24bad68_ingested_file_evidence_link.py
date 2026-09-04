"""link an ingested file to the evidence copy that preserves it

Presence of `evidence_id` is what exempts a file from the 90-day collection
expiry: the preserved copy lives in the evidence store, which nothing expires.

ON DELETE SET NULL rather than CASCADE - deleting an evidence record must not
erase the record that the file was ingested at all. The constraint is named
because SQLite's batch migration cannot drop an anonymous one, which would
leave the downgrade unrunnable.


Revision ID: 4273a24bad68
Revises: 910019bad7bd
Create Date: 2026-08-28 18:39:16.203765+00:00
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '4273a24bad68'
down_revision: Union[str, None] = '910019bad7bd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('ingested_files', schema=None) as batch_op:
        batch_op.add_column(sa.Column('evidence_id', sa.String(), nullable=True))
        batch_op.create_index(batch_op.f('ix_ingested_files_evidence_id'), ['evidence_id'], unique=False)
        batch_op.create_foreign_key('fk_ingested_files_evidence_id', 'evidences', ['evidence_id'], ['id'], ondelete='SET NULL')



def downgrade() -> None:
    with op.batch_alter_table('ingested_files', schema=None) as batch_op:
        batch_op.drop_constraint('fk_ingested_files_evidence_id', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_ingested_files_evidence_id'))
        batch_op.drop_column('evidence_id')

