"""ingested files - provenance for the unified ingestion pipeline

One row per file the pipeline has seen, whatever door it came through. Purely
additive: no existing table is touched, so the downgrade is a clean drop and an
instance rolled back loses ingest provenance and nothing else.

See docs/INGESTION.md sections 2 and 4.


Revision ID: 910019bad7bd
Revises: d7d1686462c6
Create Date: 2026-08-28 15:42:19.285152+00:00
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '910019bad7bd'
down_revision: Union[str, None] = 'd7d1686462c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('ingested_files',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('case_id', sa.String(), nullable=False),
    sa.Column('collection_id', sa.String(), nullable=True),
    sa.Column('parent_id', sa.String(), nullable=True),
    sa.Column('original_name', sa.String(), nullable=False),
    sa.Column('stored_path', sa.String(), nullable=True),
    sa.Column('size_bytes', sa.BigInteger(), nullable=False),
    sa.Column('origin', sa.String(), nullable=False),
    sa.Column('origin_detail', sa.String(), nullable=True),
    sa.Column('sha256', sa.String(), nullable=True),
    sa.Column('magic_type', sa.String(), nullable=True),
    sa.Column('detected_kind', sa.String(), nullable=True),
    sa.Column('detection_source', sa.String(), nullable=True),
    sa.Column('source_timezone', sa.String(), nullable=False),
    sa.Column('state', sa.String(), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('routed_to', sa.String(), nullable=True),
    sa.Column('parsed_artifact_id', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['case_id'], ['cases.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['collection_id'], ['imported_collections.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['parent_id'], ['ingested_files.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('ingested_files', schema=None) as batch_op:
        batch_op.create_index('ix_ingested_files_case_sha', ['case_id', 'sha256'], unique=False)
        batch_op.create_index('ix_ingested_files_case_state', ['case_id', 'state'], unique=False)
        batch_op.create_index(batch_op.f('ix_ingested_files_collection_id'), ['collection_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_ingested_files_parent_id'), ['parent_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_ingested_files_sha256'), ['sha256'], unique=False)



def downgrade() -> None:
    with op.batch_alter_table('ingested_files', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_ingested_files_sha256'))
        batch_op.drop_index(batch_op.f('ix_ingested_files_parent_id'))
        batch_op.drop_index(batch_op.f('ix_ingested_files_collection_id'))
        batch_op.drop_index('ix_ingested_files_case_state')
        batch_op.drop_index('ix_ingested_files_case_sha')

    op.drop_table('ingested_files')
