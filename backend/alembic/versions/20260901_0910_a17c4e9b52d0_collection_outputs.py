"""collection outputs - what an ingest produced, so it can be undone

One row per record a collection created in another module: a table in the
Artifact Explorer, a file in the Logs module, a dump in Memory. Deleting a
collection used to leave every one of them behind, listed and pointing at bytes
that were no longer on disk.

Purely additive: no existing table is touched, so the downgrade is a clean
drop. An instance rolled back loses the record of what each collection
produced, and deletion falls back to inferring it from file paths - which is
what this revision's service does for collections that predate the table.

See docs/INGESTION.md section 15.


Revision ID: a17c4e9b52d0
Revises: 234dcb031e0b
Create Date: 2026-09-01 09:10:00.000000+00:00
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a17c4e9b52d0'
down_revision: Union[str, None] = '234dcb031e0b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'collection_outputs',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('case_id', sa.String(), nullable=False),
        sa.Column('collection_id', sa.String(), nullable=False),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('record_id', sa.String(), nullable=False),
        sa.Column('file_path', sa.String(), nullable=True),
        sa.Column('source_file_id', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['case_id'], ['cases.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['collection_id'], ['imported_collections.id'],
                                ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('collection_outputs', schema=None) as batch_op:
        batch_op.create_index('ix_collection_outputs_record',
                              ['kind', 'record_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_collection_outputs_collection_id'),
                              ['collection_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('collection_outputs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_collection_outputs_collection_id'))
        batch_op.drop_index('ix_collection_outputs_record')
    op.drop_table('collection_outputs')
