"""What the analyst decided about a host on the conversation map

The map is computed from the capture every time, so it stores nothing. This
stores the half the packets cannot say: that 10.0.0.5 is the domain controller,
and where on the canvas it belongs.

Keyed on case and address rather than on the capture: naming a host once in an
investigation should hold for every capture in it.

Revision ID: c7a4e82b91d3
Revises: b3c9d41f7e82
Create Date: 2026-10-01

"""
from alembic import op
import sqlalchemy as sa

revision      = "c7a4e82b91d3"
down_revision = "b3c9d41f7e82"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "pcap_hosts",
        sa.Column("id",         sa.String(), primary_key=True),
        sa.Column("case_id",    sa.String(), nullable=False),
        sa.Column("address",    sa.String(length=64), nullable=False),
        sa.Column("label",      sa.String(length=255), default=""),
        sa.Column("kind",       sa.String(length=64), default=""),
        sa.Column("x",          sa.Float(), nullable=True),
        sa.Column("y",          sa.Float(), nullable=True),
        sa.Column("asset_id",   sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("case_id", "address", name="uq_pcap_host_case_address"),
    )


def downgrade() -> None:
    op.drop_table("pcap_hosts")
