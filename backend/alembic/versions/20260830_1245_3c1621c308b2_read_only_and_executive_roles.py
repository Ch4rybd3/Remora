"""read_only and executive roles

Widens users.role from VARCHAR(7) - which was exactly long enough for
"analyst" and nothing more - to VARCHAR(32).

No data changes. Every existing account keeps the role it had, and the three
original roles keep the behaviour they had: see core/permissions.py, where they
become named permission sets rather than positions on a line.

SQLite would not have enforced the old length, but another database would, and
a role silently truncated to "read_on" is a permission bug that only appears
after a migration to Postgres.


Revision ID: 3c1621c308b2
Revises: 62113824dd80
Create Date: 2026-08-30 12:45:03.569411+00:00
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3c1621c308b2'
down_revision: Union[str, None] = '62113824dd80'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column('role',
               existing_type=sa.VARCHAR(length=7),
               type_=sa.Enum('admin', 'owner', 'analyst', 'read_only', 'executive', name='userrole', length=32),
               existing_nullable=False)



def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column('role',
               existing_type=sa.Enum('admin', 'owner', 'analyst', 'read_only', 'executive', name='userrole', length=32),
               type_=sa.VARCHAR(length=7),
               existing_nullable=False)

