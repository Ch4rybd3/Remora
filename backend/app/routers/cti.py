"""
CTI (Cyber Threat Intelligence) lookup proxy.

Routes all external API calls through the backend so API keys never
reach the frontend. Connectors are read from the connector_configs table.

Supported:
  VirusTotal v3 — IPs, domains, hashes (MD5/SHA1/SHA256), URLs
  AbuseIPDB v2  — IPs only

Type auto-detection:
  IPv4 / IPv6 → ip
  32/40/64 hex chars → hash (MD5/SHA1/SHA256)
  http(s):// prefix → url
  contains dot, no spaces → domain
"""
from __future__ import annotations

import base64
import re
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.connector import ConnectorConfig
from ..models.user import User
from ..core.deps import get_current_user

router = APIRouter(prefix="/cti", tags=["cti"])

# ── Type detection ────────────────────────────────────────────────────────────

_RE_IPV4  = re.compile(r'^(\d{1,3}\.){3}\d{1,3}$')
_RE_IPV6  = re.compile(r'^[0-9a-fA-F:]{2,39}$')
_RE_MD5   = re.compile(r'^[0-9a-fA-F]{32}$')
_RE_SHA1  = re.compile(r'^[0-9a-fA-F]{40}$')
_RE_SHA256= re.compile(r'^[0-9a-fA-F]{64}$')


def _detect_type(value: str) -> str:
    v = value.strip()
    if _RE_IPV4.match(v):                          return "ip"
    if ":" in v and _RE_IPV6.match(v):            return "ip"
    if _RE_MD5.match(v):                           return "hash"
    if _RE_SHA1.match(v):                          return "hash"
    if _RE_SHA256.match(v):                        return "hash"
    if v.lower().startswith(("http://", "https://")): return "url"
    if "." in v and " " not in v:                 return "domain"
    return "unknown"


# ── Schemas ───────────────────────────────────────────────────────────────────

class LookupRequest(BaseModel):
    value:     str
    type_hint: Optional[str] = None   # override auto-detection


class VTStats(BaseModel):
    malicious:   int = 0
    suspicious:  int = 0
    harmless:    int = 0
    undetected:  int = 0
    total:       int = 0


class VTResult(BaseModel):
    stats:              VTStats
    reputation:         Optional[int]     = None
    country:            Optional[str]     = None
    as_owner:           Optional[str]     = None
    network:            Optional[str]     = None
    categories:         list[str]         = []
    tags:               list[str]         = []
    last_analysis_date: Optional[str]     = None
    meaningful_name:    Optional[str]     = None   # for files
    type_description:   Optional[str]     = None   # for files
    size:               Optional[int]     = None   # for files
    link:               str               = ""
    not_found:          bool              = False  # 404 — not in VT database yet


class AbuseResult(BaseModel):
    abuse_score:    int
    total_reports:  int
    num_distinct_users: int = 0
    country_code:   Optional[str] = None
    isp:            Optional[str] = None
    domain:         Optional[str] = None
    usage_type:     Optional[str] = None
    is_public:      bool          = True
    is_whitelisted: bool          = False
    is_tor:         bool          = False


class LookupResult(BaseModel):
    value:         str
    detected_type: str
    virustotal:    Optional[VTResult]   = None
    abuseipdb:     Optional[AbuseResult]= None
    errors:        dict[str, str]       = {}


# ── Connector key retrieval ───────────────────────────────────────────────────

def _get_key(name: str, db: Session) -> Optional[str]:
    # Avoid SQLAlchemy Boolean == True filter which can be unreliable with
    # SQLite (booleans stored as 0/1 integers). Do the check in Python instead.
    c = db.query(ConnectorConfig).filter(ConnectorConfig.name == name).first()
    if c and c.enabled and c.api_key:
        return c.api_key
    return None


# ── VirusTotal lookups ────────────────────────────────────────────────────────

_VT_BASE = "https://www.virustotal.com/api/v3"
_VT_WEB  = "https://www.virustotal.com/gui"


def _vt_headers(key: str) -> dict:
    return {"x-apikey": key}


def _parse_vt(data: dict, ioc_type: str, value: str) -> VTResult:
    attrs = data.get("data", {}).get("attributes", {})
    raw   = attrs.get("last_analysis_stats", {})
    stats = VTStats(
        malicious  = raw.get("malicious",  0),
        suspicious = raw.get("suspicious", 0),
        harmless   = raw.get("harmless",   0),
        undetected = raw.get("undetected", 0),
    )
    stats.total = stats.malicious + stats.suspicious + stats.harmless + stats.undetected

    cats = attrs.get("categories", {})
    cat_list = list(set(cats.values())) if isinstance(cats, dict) else []

    return VTResult(
        stats              = stats,
        reputation         = attrs.get("reputation"),
        country            = attrs.get("country"),
        as_owner           = attrs.get("as_owner"),
        network            = attrs.get("network"),
        categories         = cat_list,
        tags               = attrs.get("tags", []),
        last_analysis_date = str(attrs["last_analysis_date"]) if attrs.get("last_analysis_date") else None,
        meaningful_name    = attrs.get("meaningful_name"),
        type_description   = attrs.get("type_description"),
        size               = attrs.get("size"),
        link               = _vt_link(ioc_type, value),
    )


def _vt_link(ioc_type: str, value: str) -> str:
    if ioc_type == "ip":
        return f"{_VT_WEB}/ip-address/{value}"
    if ioc_type == "domain":
        return f"{_VT_WEB}/domain/{value}"
    if ioc_type == "hash":
        return f"{_VT_WEB}/file/{value}"
    return f"{_VT_WEB}/url/{value}"


def _lookup_vt(value: str, ioc_type: str, api_key: str) -> VTResult:
    if ioc_type == "ip":
        url = f"{_VT_BASE}/ip_addresses/{value}"
    elif ioc_type == "domain":
        url = f"{_VT_BASE}/domains/{value}"
    elif ioc_type == "hash":
        url = f"{_VT_BASE}/files/{value}"
    elif ioc_type == "url":
        # VT URL lookup requires base64url-encoded URL (no padding)
        url_id = base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")
        url = f"{_VT_BASE}/urls/{url_id}"
    else:
        raise ValueError(f"Unsupported type for VirusTotal: {ioc_type}")

    r = httpx.get(url, headers=_vt_headers(api_key), timeout=15)

    if r.status_code == 404:
        # Unknown to VT — return a card with not_found=True rather than an error
        return VTResult(
            stats     = VTStats(),
            link      = _vt_link(ioc_type, value),
            not_found = True,
        )
    if r.status_code == 401:
        raise ValueError("Invalid VirusTotal API key")
    if r.status_code == 429:
        raise ValueError("VirusTotal rate limit exceeded — try again in a minute")
    r.raise_for_status()

    return _parse_vt(r.json(), ioc_type, value)


# ── AbuseIPDB lookup ──────────────────────────────────────────────────────────

def _lookup_abuseipdb(ip: str, api_key: str) -> AbuseResult:
    r = httpx.get(
        "https://api.abuseipdb.com/api/v2/check",
        params={"ipAddress": ip, "maxAgeInDays": 90, "verbose": ""},
        headers={"Key": api_key, "Accept": "application/json"},
        timeout=15,
    )
    if r.status_code == 401:
        raise ValueError("Invalid AbuseIPDB API key")
    if r.status_code == 429:
        raise ValueError("AbuseIPDB rate limit exceeded")
    if r.status_code == 422:
        raise ValueError("Invalid IP address format")
    r.raise_for_status()

    d = r.json().get("data", {})
    return AbuseResult(
        abuse_score        = d.get("abuseConfidenceScore", 0),
        total_reports      = d.get("totalReports", 0),
        num_distinct_users = d.get("numDistinctUsers", 0),
        country_code       = d.get("countryCode"),
        isp                = d.get("isp"),
        domain             = d.get("domain"),
        usage_type         = d.get("usageType"),
        is_public          = d.get("isPublic", True),
        is_whitelisted     = d.get("isWhitelisted", False),
        is_tor             = d.get("isTor", False),
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/lookup", response_model=LookupResult)
def lookup(
    body:         LookupRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Lookup an IP, domain, hash, or URL across configured CTI sources.
    Auto-detects the indicator type unless type_hint is provided.
    """
    value = body.value.strip()
    if not value:
        raise HTTPException(400, "value is required")

    ioc_type = body.type_hint or _detect_type(value)
    if ioc_type == "unknown":
        raise HTTPException(400, "Cannot determine indicator type — provide type_hint")

    result = LookupResult(value=value, detected_type=ioc_type)

    vt_key    = _get_key("virustotal", db)
    abuse_key = _get_key("abuseipdb",  db)

    # ── VirusTotal ────────────────────────────────────────────────────────────
    if vt_key and ioc_type in ("ip", "domain", "hash", "url"):
        try:
            result.virustotal = _lookup_vt(value, ioc_type, vt_key)
        except Exception as exc:
            result.errors["virustotal"] = str(exc)

    # ── AbuseIPDB (IP only) ───────────────────────────────────────────────────
    if abuse_key and ioc_type == "ip":
        try:
            result.abuseipdb = _lookup_abuseipdb(value, abuse_key)
        except Exception as exc:
            result.errors["abuseipdb"] = str(exc)

    if not vt_key and not abuse_key:
        raise HTTPException(
            503,
            "No CTI connectors configured — add API keys in Config → Connectors"
        )

    return result
