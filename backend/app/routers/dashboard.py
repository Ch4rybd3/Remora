"""
Dashboard statistics endpoint.
Returns aggregated metrics across all cases, IOCs, assets, evidence, timeline and TTPs.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core import scoping
from ..core.deps import get_current_user
from ..database import get_db
from ..models.asset import Asset
from ..models.case import Case
from ..models.evidence import Evidence
from ..models.ioc import IOC
from ..models.mitre import CaseTTP
from ..models.timeline import TimelineEvent
from ..models.user import User

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# ── Response models ─────────────────────────────────────────────────────────────

class KVCount(BaseModel):
    key: str
    count: int

class RecentCase(BaseModel):
    id:             str
    title:          str
    status:         str
    severity:       str
    assigned_to:    str
    tlp:            str
    ioc_count:      int
    asset_count:    int
    evidence_count: int
    days_open:      int
    updated_at:     str

class RecentEvent(BaseModel):
    case_id:    str
    case_title: str
    event_ts:   str
    title:      str
    actor:      str

class AgingBucket(BaseModel):
    label:   str
    count:   int
    max_days: int   # upper bound (for sorting / styling)

class DashboardStats(BaseModel):
    # Case counts
    total_cases:     int
    active_cases:    int   # open + in_progress
    critical_high:   int
    closed_archived: int
    avg_age_days:    float

    # Trend (this week vs last week)
    cases_this_week: int
    cases_last_week: int

    # MTTR (mean time to resolve, recent closed cases)
    mttr_days: float

    # Raw entity counts
    total_iocs:      int
    total_assets:    int
    compromised_assets: int
    total_evidence:  int
    total_events:    int
    total_ttps:      int

    # Distributions
    by_status:   list[KVCount]
    by_severity: list[KVCount]
    by_tlp:      list[KVCount]
    ioc_by_type: list[KVCount]
    asset_by_type: list[KVCount]
    evidence_by_type: list[KVCount]
    top_tactics: list[KVCount]
    case_aging:  list[AgingBucket]
    by_analyst:  list[KVCount]

    # Activity sparkline — 12 weekly buckets (oldest first)
    activity_by_week: list[KVCount]

    # Feeds
    recent_cases:    list[RecentCase]
    recent_timeline: list[RecentEvent]


# ── Helpers ─────────────────────────────────────────────────────────────────────

def _to_utc(dt: datetime) -> datetime:
    """Ensure datetime is UTC-aware (SQLite returns naive datetimes)."""
    if dt is None:
        return datetime.now(UTC)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


def _days_since(dt: datetime) -> int:
    return max(0, (_to_utc(datetime.now(UTC)) - _to_utc(dt)).days)


# ── Endpoint ────────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=DashboardStats)
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:

    now = datetime.now(UTC)

    # ── Cases ──────────────────────────────────────────────────────────────────

    # Filtered explicitly: the dashboard aggregates across cases, so there is
    # no case id in the path for the scoping dependency to check. Counting
    # cases a scoped account cannot open would leak how many its clients do not
    # have. See `core/scoping.py`.
    all_cases = (
        scoping.filter_cases(db.query(Case), current_user)
        .order_by(Case.updated_at.desc())
        .all()
    )
    total_cases = len(all_cases)

    status_map:   dict[str, int] = {}
    severity_map: dict[str, int] = {}
    tlp_map:      dict[str, int] = {}
    age_lt1 = age_1_7 = age_7_30 = age_gt30 = 0
    age_days_list: list[int] = []

    for c in all_cases:
        s = c.status.value if hasattr(c.status, "value") else str(c.status)
        v = c.severity.value if hasattr(c.severity, "value") else str(c.severity)
        t = c.tlp or "N/A"
        status_map[s]   = status_map.get(s, 0) + 1
        severity_map[v] = severity_map.get(v, 0) + 1
        tlp_map[t]      = tlp_map.get(t, 0) + 1

        if s in ("open", "in_progress"):
            d = _days_since(c.created_at)
            age_days_list.append(d)
            if d < 1:
                age_lt1 += 1
            elif d < 7:
                age_1_7 += 1
            elif d < 30:
                age_7_30 += 1
            else:
                age_gt30 += 1

    active_cases    = status_map.get("open", 0) + status_map.get("in_progress", 0)
    closed_archived = status_map.get("closed", 0) + status_map.get("archived", 0)
    critical_high   = severity_map.get("critical", 0) + severity_map.get("high", 0)
    avg_age         = (sum(age_days_list) / len(age_days_list)) if age_days_list else 0.0

    STATUS_ORDER = ["open", "in_progress", "closed", "archived"]
    SEV_ORDER    = ["critical", "high", "medium", "low", "informational"]

    by_status   = [KVCount(key=k, count=status_map.get(k, 0)) for k in STATUS_ORDER]
    by_severity = [KVCount(key=k, count=severity_map.get(k, 0)) for k in SEV_ORDER]
    by_tlp      = sorted(
        [KVCount(key=k, count=v) for k, v in tlp_map.items()],
        key=lambda x: -x.count,
    )

    case_aging = [
        AgingBucket(label="< 1 day",   count=age_lt1,   max_days=0),
        AgingBucket(label="1 – 7 days", count=age_1_7,   max_days=7),
        AgingBucket(label="7 – 30 days",count=age_7_30,  max_days=30),
        AgingBucket(label="> 30 days",  count=age_gt30,  max_days=999),
    ]

    # ── Trend: this week vs last week ─────────────────────────────────────────
    one_week_ago  = now - timedelta(days=7)
    two_weeks_ago = now - timedelta(days=14)
    cases_this_week = sum(1 for c in all_cases if _to_utc(c.created_at) >= one_week_ago)
    cases_last_week = sum(1 for c in all_cases if two_weeks_ago <= _to_utc(c.created_at) < one_week_ago)

    # ── MTTR (mean time to resolve) ────────────────────────────────────────────
    closed_cases = [
        c for c in all_cases
        if (c.status.value if hasattr(c.status, "value") else str(c.status)) in ("closed", "archived")
    ]
    if closed_cases:
        # Use updated_at as a proxy for close date (best approximation without a closed_at column)
        durations = [
            max(0, (_to_utc(c.updated_at) - _to_utc(c.created_at)).days)
            for c in closed_cases[-50:]  # last 50 closed
        ]
        mttr_days = round(sum(durations) / len(durations), 1)
    else:
        mttr_days = 0.0

    # ── Weekly activity (last 12 weeks) ────────────────────────────────────────
    activity_by_week: list[KVCount] = []
    for w in range(11, -1, -1):
        week_start = now - timedelta(weeks=w + 1)
        week_end   = now - timedelta(weeks=w)
        cnt = sum(1 for c in all_cases if week_start <= _to_utc(c.created_at) < week_end)
        activity_by_week.append(KVCount(key=week_start.strftime("%b %d"), count=cnt))

    # ── Analyst workload ───────────────────────────────────────────────────────
    analyst_map: dict[str, int] = {}
    for c in all_cases:
        s = c.status.value if hasattr(c.status, "value") else str(c.status)
        if s not in ("closed", "archived"):
            for a in (c.assigned_to or "").split(","):
                a = a.strip()
                if a and a != "—":
                    analyst_map[a] = analyst_map.get(a, 0) + 1
    by_analyst = sorted(
        [KVCount(key=k, count=v) for k, v in analyst_map.items()],
        key=lambda x: -x.count,
    )[:8]

    # ── Recent cases feed (last 8, with counts pre-loaded via relationship) ────
    recent_raw = all_cases[:8]
    recent_cases: list[RecentCase] = []
    for c in recent_raw:
        s = c.status.value if hasattr(c.status, "value") else str(c.status)
        v = c.severity.value if hasattr(c.severity, "value") else str(c.severity)
        is_open = s in ("open", "in_progress")
        recent_cases.append(RecentCase(
            id=c.id,
            title=c.title or "(Untitled)",
            status=s,
            severity=v,
            assigned_to=c.assigned_to or "—",
            tlp=c.tlp or "",
            ioc_count=len(c.iocs) if c.iocs else 0,
            asset_count=len(c.assets) if c.assets else 0,
            evidence_count=len(c.evidences) if c.evidences else 0,
            days_open=_days_since(c.created_at) if is_open else -1,
            updated_at=_to_utc(c.updated_at).strftime("%Y-%m-%d %H:%M"),
        ))

    # ── IOCs ──────────────────────────────────────────────────────────────────
    total_iocs = db.query(func.count(IOC.id)).scalar() or 0
    ioc_rows   = (
        db.query(IOC.type, func.count(IOC.id))
        .group_by(IOC.type)
        .order_by(func.count(IOC.id).desc())
        .limit(10)
        .all()
    )
    ioc_by_type = [
        KVCount(key=row[0].value if hasattr(row[0], "value") else str(row[0]), count=row[1])
        for row in ioc_rows
    ]

    # ── Assets ─────────────────────────────────────────────────────────────────
    total_assets      = db.query(func.count(Asset.id)).scalar() or 0
    compromised_assets = db.query(func.count(Asset.id)).filter(Asset.compromised.is_(True)).scalar() or 0
    asset_rows        = (
        db.query(Asset.type, func.count(Asset.id))
        .group_by(Asset.type)
        .order_by(func.count(Asset.id).desc())
        .limit(8)
        .all()
    )
    asset_by_type = [
        KVCount(key=row[0].value if hasattr(row[0], "value") else str(row[0]), count=row[1])
        for row in asset_rows
    ]

    # ── Evidence ───────────────────────────────────────────────────────────────
    total_evidence = db.query(func.count(Evidence.id)).scalar() or 0
    ev_rows        = (
        db.query(Evidence.evidence_type, func.count(Evidence.id))
        .group_by(Evidence.evidence_type)
        .order_by(func.count(Evidence.id).desc())
        .all()
    )
    evidence_by_type = [
        KVCount(key=row[0].value if hasattr(row[0], "value") else str(row[0]), count=row[1])
        for row in ev_rows
    ]

    # ── Timeline ───────────────────────────────────────────────────────────────
    total_events = db.query(func.count(TimelineEvent.id)).scalar() or 0
    tl_rows      = (
        db.query(TimelineEvent, Case.title, Case.id)
        .join(Case, TimelineEvent.case_id == Case.id)
        .order_by(TimelineEvent.event_ts.desc())
        .limit(10)
        .all()
    )
    recent_timeline: list[RecentEvent] = []
    for ev, case_title, case_id in tl_rows:
        recent_timeline.append(RecentEvent(
            case_id=case_id,
            case_title=case_title or "(Untitled)",
            event_ts=_to_utc(ev.event_ts).strftime("%Y-%m-%d %H:%M"),
            title=ev.title or "",
            actor=ev.actor or "",
        ))

    # ── TTPs ──────────────────────────────────────────────────────────────────
    total_ttps = db.query(func.count(CaseTTP.id)).scalar() or 0
    ttp_rows   = (
        db.query(CaseTTP.tactic_name, func.count(CaseTTP.id))
        .filter(CaseTTP.tactic_name.isnot(None))
        .group_by(CaseTTP.tactic_name)
        .order_by(func.count(CaseTTP.id).desc())
        .limit(8)
        .all()
    )
    top_tactics = [KVCount(key=row[0] or row[0], count=row[1]) for row in ttp_rows]

    # ── Assemble ───────────────────────────────────────────────────────────────
    return DashboardStats(
        total_cases=total_cases,
        active_cases=active_cases,
        critical_high=critical_high,
        closed_archived=closed_archived,
        avg_age_days=round(avg_age, 1),
        cases_this_week=cases_this_week,
        cases_last_week=cases_last_week,
        mttr_days=mttr_days,
        total_iocs=total_iocs,
        total_assets=total_assets,
        compromised_assets=compromised_assets,
        total_evidence=total_evidence,
        total_events=total_events,
        total_ttps=total_ttps,
        by_status=by_status,
        by_severity=by_severity,
        by_tlp=by_tlp,
        ioc_by_type=ioc_by_type,
        asset_by_type=asset_by_type,
        evidence_by_type=evidence_by_type,
        top_tactics=top_tactics,
        case_aging=case_aging,
        by_analyst=by_analyst,
        activity_by_week=activity_by_week,
        recent_cases=recent_cases,
        recent_timeline=recent_timeline,
    )
