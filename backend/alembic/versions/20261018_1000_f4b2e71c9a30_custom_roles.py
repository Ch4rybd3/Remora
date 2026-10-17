"""Custom role profiles for user accounts

Adds a `custom_roles` table and a nullable `custom_role_id` FK on `users`.
When a user has a custom role assigned, the permission check in
`core/deps.py` uses the custom role's permission flags instead of the
built-in `UserRole` enum defaults. The base `role` column is kept as-is for
backward compatibility.

Revision ID: f4b2e71c9a30
Revises: c7a4e82b91d3
Create Date: 2026-10-18

"""
from alembic import op
import sqlalchemy as sa

revision      = "f4b2e71c9a30"
down_revision = "c7a4e82b91d3"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "custom_roles",
        sa.Column("id",          sa.String(), primary_key=True),
        sa.Column("name",        sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color",       sa.String(length=64), nullable=True),
        sa.Column("can_write",             sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("can_read_artifacts",    sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("can_change_own_password", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_custom_roles_name", "custom_roles", ["name"], unique=True)

    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("custom_role_id", sa.String(), nullable=True))
        batch.create_foreign_key(
            "fk_users_custom_role_id",
            "custom_roles",
            ["custom_role_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("fk_users_custom_role_id", type_="foreignkey")
        batch.drop_column("custom_role_id")

    op.drop_index("ix_custom_roles_name", table_name="custom_roles")
    op.drop_table("custom_roles")
