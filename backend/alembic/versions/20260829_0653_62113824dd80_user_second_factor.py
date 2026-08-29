"""second factor (TOTP) on users

Purely additive and all nullable, so an existing installation upgrades with
every account unchanged and MFA simply off. There is no backfill: enrolment is
a deliberate act by each user.

The secret is stored encrypted (see services/mfa.py). Rotating SECRET_KEY makes
it undecryptable and every enrolled user has to enrol again - already true of
every issued session token, but worth stating.


Revision ID: 62113824dd80
Revises: 4273a24bad68
Create Date: 2026-08-29 06:53:27.819877+00:00
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '62113824dd80'
down_revision: Union[str, None] = '4273a24bad68'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('mfa_enabled', sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column('mfa_secret', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('mfa_salt', sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column('mfa_recovery_codes', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('mfa_last_step', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('mfa_failed_attempts', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('mfa_locked_until', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('mfa_enrolled_at', sa.DateTime(), nullable=True))



def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('mfa_enrolled_at')
        batch_op.drop_column('mfa_locked_until')
        batch_op.drop_column('mfa_failed_attempts')
        batch_op.drop_column('mfa_last_step')
        batch_op.drop_column('mfa_recovery_codes')
        batch_op.drop_column('mfa_salt')
        batch_op.drop_column('mfa_secret')
        batch_op.drop_column('mfa_enabled')

