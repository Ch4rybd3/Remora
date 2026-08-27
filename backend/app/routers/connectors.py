"""
Connector configuration — store and test API keys for external services.

Supported connectors:
  virustotal  — VirusTotal v3 API
  abuseipdb   — AbuseIPDB v2 API
  misp        — MISP (self-hosted, requires base_url + api_key)

The API key is masked in GET responses (only last 4 chars shown).
Keys are stored in plaintext in the DB — secure your DB at the infra level.
"""
from __future__ import annotations

from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..database import get_db
from ..models.connector import ConnectorConfig
from ..models.user import User

router = APIRouter(prefix="/connectors", tags=["connectors"])

# ── Known connector metadata (used for validation + frontend) ─────────────────

KNOWN_CONNECTORS: dict[str, dict] = {
    "virustotal": {
        "label":       "VirusTotal",
        "description": "Malware & reputation lookup via VirusTotal v3 API.",
        "url":         "https://www.virustotal.com/api/v3",
        "fields":      ["api_key"],
        "docs":        "https://docs.virustotal.com/reference/overview",
    },
    "abuseipdb": {
        "label":       "AbuseIPDB",
        "description": "IP reputation and abuse reports via AbuseIPDB v2 API.",
        "url":         "https://api.abuseipdb.com/api/v2",
        "fields":      ["api_key"],
        "docs":        "https://docs.abuseipdb.com/",
    },
    "shodan": {
        "label":       "Shodan",
        "description": "Internet-wide scan data — open ports, banners, CVEs. Free tier available.",
        "url":         "https://api.shodan.io",
        "fields":      ["api_key"],
        "docs":        "https://developer.shodan.io/api",
        "register":    "https://account.shodan.io/register",
    },
    "alienvault_otx": {
        "label":       "AlienVault OTX",
        "description": "Open Threat Exchange — pulses, malware families, adversaries. Works without key (public data).",
        "url":         "https://otx.alienvault.com/api/v1",
        "fields":      ["api_key"],
        "docs":        "https://otx.alienvault.com/api",
        "register":    "https://otx.alienvault.com/accounts/signup",
    },
    "urlscan": {
        "label":       "URLScan.io",
        "description": "URL/domain scanner — screenshots, verdicts, ASN. Free tier available.",
        "url":         "https://urlscan.io/api/v1",
        "fields":      ["api_key"],
        "docs":        "https://urlscan.io/docs/api/",
        "register":    "https://urlscan.io/user/signup",
    },
    "misp": {
        "label":       "MISP",
        "description": "Self-hosted MISP threat sharing platform (requires base_url).",
        "url":         None,
        "fields":      ["api_key", "base_url"],
        "docs":        "https://www.misp-project.org/openapi/",
    },
}

# ── Schemas ───────────────────────────────────────────────────────────────────

class ConnectorOut(BaseModel):
    name:        str
    api_key:     str | None   # masked
    base_url:    str | None
    enabled:     bool
    updated_at:  datetime | None
    updated_by:  str | None

    model_config = {"from_attributes": True}


class ConnectorUpsert(BaseModel):
    api_key:  str | None = None
    base_url: str | None = None
    enabled:  bool          = True


class TestResult(BaseModel):
    ok:      bool
    message: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mask(key: str | None) -> str | None:
    """Show only the last 4 chars of an API key."""
    if not key:
        return None
    visible = key[-4:] if len(key) >= 4 else key
    return "••••••••••••••••" + visible


def _get_or_create(name: str, db: Session) -> ConnectorConfig:
    c = db.query(ConnectorConfig).filter(ConnectorConfig.name == name).first()
    if not c:
        c = ConnectorConfig(name=name)
        db.add(c)
    return c


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[ConnectorOut])
def list_connectors(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Return config for all known connectors (masked keys)."""
    rows = {
        c.name: c
        for c in db.query(ConnectorConfig).all()
    }
    result = []
    for name in KNOWN_CONNECTORS:
        row = rows.get(name)
        if row:
            result.append(ConnectorOut(
                name=row.name,
                api_key=_mask(row.api_key),
                base_url=row.base_url,
                enabled=row.enabled,
                updated_at=row.updated_at,
                updated_by=row.updated_by,
            ))
        else:
            result.append(ConnectorOut(
                name=name,
                api_key=None,
                base_url=None,
                enabled=False,
                updated_at=None,
                updated_by=None,
            ))
    return result


@router.put("/{name}", response_model=ConnectorOut)
def upsert_connector(
    name:         str,
    body:         ConnectorUpsert,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Create or update connector configuration."""
    if name not in KNOWN_CONNECTORS:
        raise HTTPException(400, f"Unknown connector: {name}")

    c = _get_or_create(name, db)

    # Only update api_key if a non-placeholder value is sent
    if body.api_key is not None and not body.api_key.startswith("••"):
        c.api_key = body.api_key.strip() or None

    if body.base_url is not None:
        c.base_url = body.base_url.strip() or None

    c.enabled    = body.enabled
    c.updated_at = datetime.now(UTC)
    c.updated_by = current_user.username
    db.commit()
    db.refresh(c)

    return ConnectorOut(
        name=c.name,
        api_key=_mask(c.api_key),
        base_url=c.base_url,
        enabled=c.enabled,
        updated_at=c.updated_at,
        updated_by=c.updated_by,
    )


@router.delete("/{name}/key", response_model=ConnectorOut)
def clear_api_key(
    name:         str,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Remove the stored API key for a connector."""
    if name not in KNOWN_CONNECTORS:
        raise HTTPException(400, f"Unknown connector: {name}")
    c = _get_or_create(name, db)
    c.api_key    = None
    c.enabled    = False
    c.updated_at = datetime.now(UTC)
    c.updated_by = current_user.username
    db.commit()
    db.refresh(c)
    return ConnectorOut(
        name=c.name, api_key=None, base_url=c.base_url,
        enabled=c.enabled, updated_at=c.updated_at, updated_by=c.updated_by,
    )


@router.post("/{name}/test", response_model=TestResult)
def test_connector(
    name: str,
    db:   Session = Depends(get_db),
    _:    User    = Depends(get_current_user),
):
    """Test connectivity with the stored credentials."""
    if name not in KNOWN_CONNECTORS:
        raise HTTPException(400, f"Unknown connector: {name}")

    c = db.query(ConnectorConfig).filter(ConnectorConfig.name == name).first()
    if not c or not c.api_key:
        return TestResult(ok=False, message="No API key configured")

    try:
        if name == "virustotal":
            return _test_virustotal(c.api_key)
        elif name == "abuseipdb":
            return _test_abuseipdb(c.api_key)
        elif name == "misp":
            return _test_misp(c.api_key, c.base_url)
        else:
            return TestResult(ok=False, message="No test available for this connector")
    except Exception as exc:
        return TestResult(ok=False, message=str(exc))


# ── Connector test implementations ────────────────────────────────────────────

def _test_virustotal(api_key: str) -> TestResult:
    """Lookup 8.8.8.8 as a sanity check."""
    try:
        r = httpx.get(
            "https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8",
            headers={"x-apikey": api_key},
            timeout=10,
        )
        if r.status_code == 200:
            return TestResult(ok=True, message="Connected to VirusTotal API v3")
        if r.status_code == 401:
            return TestResult(ok=False, message="Invalid API key (401 Unauthorized)")
        if r.status_code == 429:
            return TestResult(ok=False, message="Rate limit exceeded (429) — key valid but quota hit")
        return TestResult(ok=False, message=f"Unexpected status: {r.status_code}")
    except httpx.ConnectError:
        return TestResult(ok=False, message="Connection error — check internet access")
    except httpx.TimeoutException:
        return TestResult(ok=False, message="Request timed out")


def _test_abuseipdb(api_key: str) -> TestResult:
    try:
        r = httpx.get(
            "https://api.abuseipdb.com/api/v2/check",
            params={"ipAddress": "8.8.8.8", "maxAgeInDays": 90},
            headers={"Key": api_key, "Accept": "application/json"},
            timeout=10,
        )
        if r.status_code == 200:
            return TestResult(ok=True, message="Connected to AbuseIPDB API v2")
        if r.status_code == 401:
            return TestResult(ok=False, message="Invalid API key (401 Unauthorized)")
        if r.status_code == 429:
            return TestResult(ok=False, message="Rate limit exceeded (429)")
        return TestResult(ok=False, message=f"Unexpected status: {r.status_code}")
    except httpx.ConnectError:
        return TestResult(ok=False, message="Connection error — check internet access")
    except httpx.TimeoutException:
        return TestResult(ok=False, message="Request timed out")


def _test_misp(api_key: str, base_url: str | None) -> TestResult:
    if not base_url:
        return TestResult(ok=False, message="No base URL configured for MISP")
    url = base_url.rstrip("/") + "/users/view/me.json"
    try:
        r = httpx.get(
            url,
            headers={"Authorization": api_key, "Accept": "application/json"},
            timeout=10,
            verify=False,  # self-signed certs common on private MISP
        )
        if r.status_code == 200:
            return TestResult(ok=True, message="Connected to MISP instance")
        if r.status_code in (401, 403):
            return TestResult(ok=False, message="Authentication failed — check API key")
        return TestResult(ok=False, message=f"Unexpected status: {r.status_code}")
    except httpx.ConnectError:
        return TestResult(ok=False, message=f"Cannot reach MISP at {base_url}")
    except httpx.TimeoutException:
        return TestResult(ok=False, message="Request timed out")
