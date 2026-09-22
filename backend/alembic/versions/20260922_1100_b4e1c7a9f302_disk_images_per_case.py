"""disk images belong to a case

Images were never scoped. `GET /disk-images` listed every file under the
configured roots, so every case showed every image on the volume and no row
anywhere recorded which investigation was working on which acquisition.

This table is that record. It holds a claim, not the bytes: the image stays on
the mounted volume, and deleting a case or unregistering an image removes only
the claim. Browsing is reached through a registration, which is also what takes
analyst-supplied filesystem paths off the browse endpoints.

Purely additive - no existing table is touched, and the downgrade is a clean
drop. An instance rolled back loses the case-to-image links and returns to
listing the volume.

Revision ID: b4e1c7a9f302
Revises: a17c4e9b52d0
Create Date: 2026-09-22 11:00:00.000000+00:00
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b4e1c7a9f302'
down_revision: Union[str, None] = 'a17c4e9b52d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'disk_images',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('case_id', sa.String(), nullable=False),
        sa.Column('path', sa.String(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('size_bytes', sa.BigInteger(), nullable=False),
        sa.Column('image_format', sa.String(length=16), nullable=False),
        sa.Column('registered_at', sa.DateTime(), nullable=False),
        sa.Column('registered_by', sa.String(length=100), nullable=True),
        sa.ForeignKeyConstraint(['case_id'], ['cases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        # One claim per case per image. The same acquisition may still be
        # registered to several cases - two investigations for one client can
        # legitimately examine the same bytes.
        sa.UniqueConstraint('case_id', 'path', name='uq_disk_image_case_path'),
    )
    with op.batch_alter_table('disk_images', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_disk_images_case_id'),
                              ['case_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('disk_images', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_disk_images_case_id'))
    op.drop_table('disk_images')
