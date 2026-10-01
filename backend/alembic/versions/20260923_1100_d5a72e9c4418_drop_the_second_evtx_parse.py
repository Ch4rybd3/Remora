"""drop the tables of the retired EVTX parse

The Logs module parsed every event log a second time and stored the records in
`evtx_events`, while EvtxECmd had already parsed the same file into the
Artifact Explorer at ingestion. The module and its reader were retired in the
same change that added this revision's parent; these are the tables they left.

Two tables, and they were not equally easy to give up.

`evtx_events` is a machine re-parse. Everything in it exists in the Explorer's
own table, produced by a better parser, and the source EVTX is still registered
and still on disk - so nothing here is a unique record of anything.

`evtx_case_selections` is different: it held events an *analyst* chose to pin,
one row per case. That is a judgement, not a derivation. Anything already sent
to a case timeline is there and unaffected; anything pinned and not sent is the
part that goes.

Dropped rather than left orphaned because no instance is carrying real cases in
it - this ships before anyone deploys the version that stopped writing them.
Had that not been true, the honest move would have been to leave both tables in
place and let an operator decide.

Revision ID: d5a72e9c4418
Revises: c8f3a1d45b20
Create Date: 2026-09-23 11:00:00.000000+00:00
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd5a72e9c4418'
down_revision: Union[str, None] = 'c8f3a1d45b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table('evtx_case_selections')
    op.drop_table('evtx_events')


def downgrade() -> None:
    """
    Recreate both tables, empty.

    A drop is a drop: the rows do not come back. What this restores is the
    shape, so an instance rolled back to the version that still wrote them
    starts filling them again rather than failing on a missing table.
    """
    op.create_table(
        'evtx_events',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('file_id', sa.String(), nullable=False),
        sa.Column('record_id', sa.Integer(), nullable=True),
        sa.Column('time_created', sa.DateTime(), nullable=True),
        sa.Column('event_id', sa.Integer(), nullable=True),
        sa.Column('level', sa.Integer(), nullable=True),
        sa.Column('level_name', sa.String(length=32), nullable=True),
        sa.Column('channel', sa.String(length=255), nullable=True),
        sa.Column('provider', sa.String(length=512), nullable=True),
        sa.Column('computer', sa.String(length=255), nullable=True),
        sa.Column('user_id', sa.String(length=64), nullable=True),
        sa.Column('event_data', sa.JSON(), nullable=True),
        sa.Column('searchable_text', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['file_id'], ['evtx_files.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('evtx_events', schema=None) as batch_op:
        batch_op.create_index('ix_evtx_events_event_id', ['event_id'], unique=False)
        batch_op.create_index('ix_evtx_events_file_time', ['file_id', 'time_created'], unique=False)
        batch_op.create_index('ix_evtx_events_file_channel', ['file_id', 'channel'], unique=False)
        batch_op.create_index('ix_evtx_events_file_eid', ['file_id', 'event_id'], unique=False)
        batch_op.create_index('ix_evtx_events_file_level', ['file_id', 'level'], unique=False)

    op.create_table(
        'evtx_case_selections',
        sa.Column('case_id', sa.String(), nullable=False),
        sa.Column('events', sa.JSON(), nullable=False),
        sa.Column('sent_ids', sa.JSON(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['case_id'], ['cases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('case_id'),
    )
