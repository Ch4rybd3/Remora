"""restrict an account to a set of clients

A join table and nothing else. It starts empty, and an account with no rows in
it sees everything - so every existing account keeps exactly the access it had,
and scoping is something an administrator turns on per account rather than
something this migration does to anyone.

See core/scoping.py for why "empty means unrestricted" rather than "empty means
nothing".


Revision ID: 234dcb031e0b
Revises: 3c1621c308b2
Create Date: 2026-08-30 13:28:54.156591+00:00
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '234dcb031e0b'
down_revision: Union[str, None] = '3c1621c308b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('user_clients',
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('client_id', sa.String(), nullable=False),
    sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'client_id')
    )


def downgrade() -> None:
    op.drop_table('user_clients')
