"""Charybdis — hypotheses and the evaluation bench

`agent_hypotheses` and `agent_hypothesis_links` hold the competing
explanations of an incident and how each finding bears on each.
`agent_bench_runs` records each golden case run on a model and its score
(docs/CHARYBDIS_FEATURES.md, S34). Pausing a task needs no schema change: it
is a new value of `agent_tasks.status`.

Revision ID: c8f4a1e6b293
Revises: b5d2e8f1a367
Create Date: 2026-11-08

"""
from alembic import op
import sqlalchemy as sa

revision      = "c8f4a1e6b293"
down_revision = "b5d2e8f1a367"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "agent_hypotheses",
        sa.Column("id",         sa.String(),    primary_key=True),
        sa.Column("case_id",    sa.String(),    sa.ForeignKey("cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ref",        sa.Integer(),   nullable=False),
        sa.Column("statement",  sa.Text(),      nullable=False),
        sa.Column("state",      sa.String(16),  nullable=False),
        sa.Column("created_by", sa.String(255), nullable=False),
        sa.Column("decided_by", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(),  nullable=False),
        sa.Column("updated_at", sa.DateTime(),  nullable=False),
    )
    op.create_index("ix_agent_hypotheses_case_id", "agent_hypotheses", ["case_id"])
    op.create_index("ix_agent_hypotheses_case_ref", "agent_hypotheses", ["case_id", "ref"], unique=True)

    op.create_table(
        "agent_hypothesis_links",
        sa.Column("hypothesis_id", sa.String(),    sa.ForeignKey("agent_hypotheses.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("finding_id",    sa.String(),    sa.ForeignKey("agent_findings.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("stance",        sa.String(8),   nullable=False),
        sa.Column("note",          sa.Text(),      nullable=False),
        sa.Column("set_by",        sa.String(255), nullable=False),
        sa.Column("updated_at",    sa.DateTime(),  nullable=False),
    )

    op.create_table(
        "agent_bench_runs",
        sa.Column("id",          sa.String(),    primary_key=True),
        sa.Column("bench_id",    sa.String(64),  nullable=False),
        sa.Column("provider",    sa.String(64),  nullable=False),
        sa.Column("model",       sa.String(128), nullable=False),
        sa.Column("status",      sa.String(16),  nullable=False),
        sa.Column("score",       sa.Integer(),   nullable=False),
        sa.Column("total",       sa.Integer(),   nullable=False),
        sa.Column("details",     sa.Text(),      nullable=False),
        sa.Column("tokens_in",   sa.Integer(),   nullable=False),
        sa.Column("tokens_out",  sa.Integer(),   nullable=False),
        sa.Column("cost_usd",    sa.Float(),     nullable=False),
        sa.Column("model_calls", sa.Integer(),   nullable=False),
        sa.Column("error",       sa.Text(),      nullable=True),
        sa.Column("started_by",  sa.String(255), nullable=False),
        sa.Column("started_at",  sa.DateTime(),  nullable=False),
        sa.Column("finished_at", sa.DateTime(),  nullable=True),
    )
    op.create_index("ix_agent_bench_runs_bench_id", "agent_bench_runs", ["bench_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_bench_runs_bench_id", table_name="agent_bench_runs")
    op.drop_table("agent_bench_runs")
    op.drop_table("agent_hypothesis_links")
    op.drop_index("ix_agent_hypotheses_case_ref", table_name="agent_hypotheses")
    op.drop_index("ix_agent_hypotheses_case_id", table_name="agent_hypotheses")
    op.drop_table("agent_hypotheses")
