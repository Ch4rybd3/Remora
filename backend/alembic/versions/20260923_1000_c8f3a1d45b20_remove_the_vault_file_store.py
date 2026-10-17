"""remove the vault file store

The `vaults` table indexed a generic file store - PDFs, images, archives,
Obsidian exports - kept outside any case as shared reference material. It is
being removed because the need it served is met elsewhere.

**What this drops: the index, not the files.** The rows recorded a name, a
description, tags and a path; the bytes live under `<evidence store>/../vaults/`
and are left exactly where they are. An operator who wants them gone deletes
that directory deliberately, having looked at it. A migration that removed
somebody's reference library as a side effect of a refactor would be the wrong
kind of clean.

So take a copy of the table before upgrading if the metadata matters - the
descriptions and tags are the only record of what each file was, and they are
not recoverable from the filenames.

**Not to be confused with the knowledge base.** Two different things were
called "vault": this store, and the Obsidian note folder at `/knowledge`. They
shared the word and nothing else. The notes are untouched - they were never in
this table, they live in their own directory, and the page that reads them is
still there.

Revision ID: c8f3a1d45b20
Revises: b4e1c7a9f302
Create Date: 2026-09-23 10:00:00.000000+00:00
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8f3a1d45b20'
down_revision: Union[str, None] = 'b4e1c7a9f302'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table('vaults')


def downgrade() -> None:
    """
    Recreate the table, empty.

    A downgrade cannot bring the rows back - a drop is a drop - so this
    restores the shape and nothing else. The files it indexed are still on
    disk, which is what makes re-indexing them possible at all.
    """
    op.create_table(
        'vaults',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('tags', sa.Text(), nullable=True),
        sa.Column('file_path', sa.String(), nullable=False),
        sa.Column('file_name', sa.String(length=255), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=True),
        sa.Column('mime_type', sa.String(length=120), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('created_by', sa.String(length=100), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
