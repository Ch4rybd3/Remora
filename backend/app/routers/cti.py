"""
CTI (Cyber Threat Intelligence) lookup proxy.

Routes all external API calls through the backend so API keys never
reach the frontend. Connectors are read from the connector_configs table.

Supported:
  VirusTotal v3  — IPs, domains, hashes, URLs
  AbuseIPDB v2   — IPs only
  AlienVault OTX — IPs, domains, hashes, URLs (free, key optional)
  Shodan         — IPs only
  URLScan.io     — URLs, domains

Geo:
  ip-api.com     — batch IP geolocation (no key, 45 req/min)
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

_RE_IPV4   = re.compile(r'^(\d{1,3}\.){3}\d{1,3}$')
_RE_IPV6   = re.compile(r'^[0-9a-fA-F:]{2,39}$')
_RE_MD5    = re.compile(r'^[0-9a-fA-F]{32}$')
_RE_SHA1   = re.compile(r'^[0-9a-fA-F]{40}$')
_RE_SHA256 = re.compile(r'^[0-9a-fA-F]{64}$')


def _detect_type(value: str) -> str:
    v = value.strip()
    if _RE_IPV4.match(v):                              return "ip"
    if ":" in v and _RE_IPV6.match(v):                return "ip"
    if _RE_MD5.match(v):                               return "hash"
    if _RE_SHA1.match(v):                              return "hash"
    if _RE_SHA256.match(v):                            return "hash"
    if v.lower().startswith(("http://", "https://")): return "url"
    if "." in v and " " not in v:                     return "domain"
    return "unknown"


# ── Schemas ───────────────────────────────────────────────────────────────────

class LookupRequest(BaseModel):
    value:     str
    type_hint: Optional[str] = None


class BatchLookupRequest(BaseModel):
    values:    list[str]
    type_hint: Optional[str] = None


class VTStats(BaseModel):
    malicious:  int = 0
    suspicious: int = 0
    harmless:   int = 0
    undetected: int = 0
    total:      int = 0


class VTResult(BaseModel):
    stats:              VTStats
    reputation:         Optional[int]  = None
    country:            Optional[str]  = None
    as_owner:           Optional[str]  = None
    network:            Optional[str]  = None
    categories:         list[str]      = []
    tags:               list[str]      = []
    last_analysis_date: Optional[str]  = None
    meaningful_name:    Optional[str]  = None
    type_description:   Optional[str]  = None
    size:               Optional[int]  = None
    link:               str            = ""
    not_found:          bool           = False


class AbuseResult(BaseModel):
    abuse_score:        int
    total_reports:      int
    num_distinct_users: int           = 0
    country_code:       Optional[str] = None
    isp:                Optional[str] = None
    domain:             Optional[str] = None
    usage_type:         Optional[str] = None
    is_public:          bool          = True
    is_whitelisted:     bool          = False
    is_tor:             bool          = False


class OTXPulse(BaseModel):
    id:          str
    name:        str
    author:      Optional[str] = None
    tags:        list[str]     = []
    malware_families: list[str] = []
    targeted_countries: list[str] = []


class OTXResult(BaseModel):
    pulse_count:      int           = 0
    pulses:           list[OTXPulse] = []
    malware_families: list[str]     = []
    adversary:        Optional[str] = None
    country:          Optional[str] = None
    asn:              Optional[str] = None
    reputation:       int           = 0
    not_found:        bool          = False


class ShodanResult(BaseModel):
    ip:             str
    org:            Optional[str]  = None
    isp:            Optional[str]  = None
    country:        Optional[str]  = None
    city:           Optional[str]  = None
    ports:          list[int]      = []
    hostnames:      list[str]      = []
    vulns:          list[str]      = []
    tags:           list[str]      = []
    os:             Optional[str]  = None
    last_update:    Optional[str]  = None
    not_found:      bool           = False


class URLScanResult(BaseModel):
    verdict:    Optional[str] = None   # "malicious" | "suspicious" | "benign" | "unrated"
    score:      int           = 0
    screenshot: Optional[str] = None   # URL to screenshot
    url:        Optional[str] = None
    domain:     Optional[str] = None
    ip:         Optional[str] = None
    asn:        Optional[str] = None
    country:    Optional[str] = None
    categories: list[str]     = []
    tags:       list[str]     = []
    scan_id:    Optional[str] = None
    not_found:  bool          = False


class GeoPoint(BaseModel):
    ip:           str
    lat:          float
    lng:          float
    country:      Optional[str] = None
    country_code: Optional[str] = None
    city:         Optional[str] = None
    isp:          Optional[str] = None
    verdict:      Optional[str] = None   # injected by frontend cache


class LookupResult(BaseModel):
    value:         str
    detected_type: str
    virustotal:    Optional[VTResult]    = None
    abuseipdb:     Optional[AbuseResult] = None
    otx:           Optional[OTXResult]   = None
    shodan:        Optional[ShodanResult]= None
    urlscan:       Optional[URLScanResult]= None
    errors:        dict[str, str]        = {}


# ── Connector key retrieval ───────────────────────────────────────────────────

def _get_key(name: str, db: Session) -> Optional[str]:
    c = db.query(ConnectorConfig).filter(ConnectorConfig.name == name).first()
    if c and c.enabled and c.api_key:
        return c.api_key
    return None


# ── VirusTotal ────────────────────────────────────────────────────────────────

_VT_BASE = "https://www.virustotal.com/api/v3"
_VT_WEB  = "https://www.virustotal.com/gui"


def _vt_link(ioc_type: str, value: str) -> str:
    if ioc_type == "ip":     return f"{_VT_WEB}/ip-address/{value}"
    if ioc_type == "domain": return f"{_VT_WEB}/domain/{value}"
    if ioc_type == "hash":   return f"{_VT_WEB}/file/{value}"
    return f"{_VT_WEB}/url/{value}"


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
    return VTResult(
        stats              = stats,
        reputation         = attrs.get("reputation"),
        country            = attrs.get("country"),
        as_owner           = attrs.get("as_owner"),
        network            = attrs.get("network"),
        categories         = list(set(cats.values())) if isinstance(cats, dict) else [],
        tags               = attrs.get("tags", []),
        last_analysis_date = str(attrs["last_analysis_date"]) if attrs.get("last_analysis_date") else None,
        meaningful_name    = attrs.get("meaningful_name"),
        type_description   = attrs.get("type_description"),
        size               = attrs.get("size"),
        link               = _vt_link(ioc_type, value),
    )


def _lookup_vt(value: str, ioc_type: str, api_key: str) -> VTResult:
    if ioc_type == "ip":
        url = f"{_VT_BASE}/ip_addresses/{value}"
    elif ioc_type == "domain":
        url = f"{_VT_BASE}/domains/{value}"
    elif ioc_type == "hash":
        url = f"{_VT_BASE}/files/{value}"
    elif ioc_type == "url":
        url_id = base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")
        url    = f"{_VT_BASE}/urls/{url_id}"
    else:
        raise ValueError(f"Unsupported type for VirusTotal: {ioc_type}")

    r = httpx.get(url, headers={"x-apikey": api_key}, timeout=15)
    if r.status_code == 404:
        return VTResult(stats=VTStats(), link=_vt_link(ioc_type, value), not_found=True)
    if r.status_code == 401:
        raise ValueError("Invalid VirusTotal API key")
    if r.status_code == 429:
        raise ValueError("VirusTotal rate limit exceeded — try again in a minute")
    r.raise_for_status()
    return _parse_vt(r.json(), ioc_type, value)


# ── AbuseIPDB ─────────────────────────────────────────────────────────────────

def _lookup_abuseipdb(ip: str, api_key: str) -> AbuseResult:
    r = httpx.get(
        "https://api.abuseipdb.com/api/v2/check",
        params={"ipAddress": ip, "maxAgeInDays": 90, "verbose": ""},
        headers={"Key": api_key, "Accept": "application/json"},
        timeout=15,
    )
    if r.status_code == 401: raise ValueError("Invalid AbuseIPDB API key")
    if r.status_code == 429: raise ValueError("AbuseIPDB rate limit exceeded")
    if r.status_code == 422: raise ValueError("Invalid IP address format")
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


# ── AlienVault OTX ────────────────────────────────────────────────────────────

_OTX_BASE = "https://otx.alienvault.com/api/v1"


def _lookup_otx(value: str, ioc_type: str, api_key: Optional[str]) -> OTXResult:
    headers = {"X-OTX-API-KEY": api_key} if api_key else {}

    if ioc_type == "ip":
        sections = ["general", "reputation"]
        base_url = f"{_OTX_BASE}/indicators/IPv4/{value}"
    elif ioc_type == "domain":
        sections = ["general"]
        base_url = f"{_OTX_BASE}/indicators/domain/{value}"
    elif ioc_type == "hash":
        sections = ["general"]
        base_url = f"{_OTX_BASE}/indicators/file/{value}"
    elif ioc_type == "url":
        sections = ["general"]
        base_url = f"{_OTX_BASE}/indicators/url/{value}"
    else:
        raise ValueError(f"Unsupported type for OTX: {ioc_type}")

    r = httpx.get(f"{base_url}/general", headers=headers, timeout=15)
    if r.status_code == 404:
        return OTXResult(not_found=True)
    if r.status_code == 403:
        raise ValueError("OTX API key required or invalid")
    r.raise_for_status()
    data = r.json()

    pulse_info = data.get("pulse_info", {})
    pulses_raw = pulse_info.get("pulses", [])[:5]   # cap at 5 for display

    pulses = [
        OTXPulse(
            id     = p.get("id", ""),
            name   = p.get("name", ""),
            author = p.get("author_name"),
            tags   = p.get("tags", [])[:6],
            malware_families  = [m.get("display_name", "") for m in p.get("malware_families", [])],
            targeted_countries= p.get("targeted_countries", []),
        )
        for p in pulses_raw
    ]

    # Aggregate malware families across all pulses
    all_families: list[str] = []
    for p in pulse_info.get("pulses", []):
        for m in p.get("malware_families", []):
            name = m.get("display_name", "")
            if name and name not in all_families:
                all_families.append(name)

    return OTXResult(
        pulse_count      = pulse_info.get("count", 0),
        pulses           = pulses,
        malware_families = all_families[:10],
        adversary        = data.get("adversary"),
        country          = data.get("country_name"),
        asn              = data.get("asn"),
        reputation       = data.get("reputation", 0),
    )


# ── Shodan ────────────────────────────────────────────────────────────────────

def _lookup_shodan(ip: str, api_key: str) -> ShodanResult:
    r = httpx.get(
        f"https://api.shodan.io/shodan/host/{ip}",
        params={"key": api_key},
        timeout=15,
    )
    if r.status_code == 404:
        return ShodanResult(ip=ip, not_found=True)
    if r.status_code == 401:
        raise ValueError("Invalid Shodan API key")
    if r.status_code == 429:
        raise ValueError("Shodan rate limit exceeded")
    r.raise_for_status()
    d = r.json()

    ports = sorted({s.get("port", 0) for s in d.get("data", []) if s.get("port")})
    vulns = list(d.get("vulns", {}).keys())

    return ShodanResult(
        ip          = ip,
        org         = d.get("org"),
        isp         = d.get("isp"),
        country     = d.get("country_name"),
        city        = d.get("city"),
        ports       = ports[:20],
        hostnames   = d.get("hostnames", [])[:5],
        vulns       = vulns[:10],
        tags        = d.get("tags", []),
        os          = d.get("os"),
        last_update = d.get("last_update"),
    )


# ── URLScan.io ────────────────────────────────────────────────────────────────

def _lookup_urlscan(value: str, ioc_type: str, api_key: Optional[str]) -> URLScanResult:
    """Search URLScan for existing scans of this URL/domain."""
    headers = {"API-Key": api_key} if api_key else {}
    query   = f'page.domain:"{value}"' if ioc_type == "domain" else f'page.url:"{value}"'

    r = httpx.get(
        "https://urlscan.io/api/v1/search/",
        params={"q": query, "size": 1},
        headers=headers,
        timeout=15,
    )
    if r.status_code in (401, 429):
        raise ValueError(f"URLScan error {r.status_code}")
    r.raise_for_status()

    results = r.json().get("results", [])
    if not results:
        return URLScanResult(not_found=True)

    hit  = results[0]
    page = hit.get("page", {})
    verdicts = hit.get("verdicts", {}).get("overall", {})

    return URLScanResult(
        verdict    = "malicious" if verdicts.get("malicious") else
                     "suspicious" if verdicts.get("score", 0) > 30 else "benign",
        score      = verdicts.get("score", 0),
        screenshot = hit.get("screenshot"),
        url        = page.get("url"),
        domain     = page.get("domain"),
        ip         = page.get("ip"),
        asn        = page.get("asn"),
        country    = page.get("country"),
        categories = verdicts.get("categories", []),
        tags       = hit.get("tags", []),
        scan_id    = hit.get("_id"),
    )


# ── Geo batch ─────────────────────────────────────────────────────────────────

def _geolocate_ips(ips: list[str]) -> list[GeoPoint]:
    """Batch geolocate IPs via ip-api.com (free, 45 req/min, max 100/batch)."""
    if not ips:
        return []
    points: list[GeoPoint] = []
    # Process in chunks of 100
    for i in range(0, len(ips), 100):
        chunk = ips[i:i + 100]
        try:
            r = httpx.post(
                "http://ip-api.com/batch",
                json=[{"query": ip, "fields": "status,message,country,countryCode,city,lat,lon,isp,query"} for ip in chunk],
                timeout=10,
            )
            r.raise_for_status()
            for item in r.json():
                if item.get("status") == "success":
                    points.append(GeoPoint(
                        ip           = item["query"],
                        lat          = item["lat"],
                        lng          = item["lon"],
                        country      = item.get("country"),
                        country_code = item.get("countryCode"),
                        city         = item.get("city"),
                        isp          = item.get("isp"),
                    ))
        except Exception as e:
            print(f"[cti/geo] batch error: {e}", flush=True)
    return points


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/lookup", response_model=LookupResult)
def lookup(
    body:         LookupRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    value    = body.value.strip()
    if not value:
        raise HTTPException(400, "value is required")

    ioc_type = body.type_hint or _detect_type(value)
    if ioc_type == "unknown":
        raise HTTPException(400, "Cannot determine indicator type — provide type_hint")

    result    = LookupResult(value=value, detected_type=ioc_type)
    vt_key    = _get_key("virustotal", db)
    abuse_key = _get_key("abuseipdb",  db)
    otx_key   = _get_key("alienvault_otx", db)   # optional — OTX works without key for public data
    shodan_key= _get_key("shodan", db)
    urlscan_key = _get_key("urlscan", db)         # optional

    # VirusTotal
    if vt_key and ioc_type in ("ip", "domain", "hash", "url"):
        try:
            result.virustotal = _lookup_vt(value, ioc_type, vt_key)
        except Exception as e:
            result.errors["virustotal"] = str(e)

    # AbuseIPDB
    if abuse_key and ioc_type == "ip":
        try:
            result.abuseipdb = _lookup_abuseipdb(value, abuse_key)
        except Exception as e:
            result.errors["abuseipdb"] = str(e)

    # AlienVault OTX (works without key for public data)
    if ioc_type in ("ip", "domain", "hash", "url"):
        try:
            result.otx = _lookup_otx(value, ioc_type, otx_key)
        except Exception as e:
            result.errors["otx"] = str(e)

    # Shodan (IPs only)
    if shodan_key and ioc_type == "ip":
        try:
            result.shodan = _lookup_shodan(value, shodan_key)
        except Exception as e:
            result.errors["shodan"] = str(e)

    # URLScan.io (URLs and domains)
    if ioc_type in ("url", "domain"):
        try:
            result.urlscan = _lookup_urlscan(value, ioc_type, urlscan_key)
        except Exception as e:
            result.errors["urlscan"] = str(e)

    if not vt_key and not abuse_key and not otx_key and not shodan_key:
        # OTX works without key, so at least that ran — don't 503
        pass

    return result


@router.post("/geo", response_model=list[GeoPoint])
def geolocate(
    body:         dict,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Batch geolocate a list of IP addresses. Returns lat/lng for each resolved IP."""
    ips = [str(ip).strip() for ip in body.get("ips", []) if ip]
    if not ips:
        return []
    # Deduplicate while preserving order
    seen: set[str] = set()
    unique = [ip for ip in ips if not (ip in seen or seen.add(ip))]  # type: ignore[func-returns-value]
    return _geolocate_ips(unique[:200])   # hard cap


@router.post("/batch", response_model=list[LookupResult])
def batch_lookup(
    body:         BatchLookupRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Lookup multiple IOCs. Capped at 20 to avoid rate-limiting."""
    values = [v.strip() for v in body.values if v.strip()][:20]
    results = []
    for value in values:
        ioc_type = body.type_hint or _detect_type(value)
        if ioc_type == "unknown":
            results.append(LookupResult(value=value, detected_type="unknown",
                                        errors={"detect": "Unknown type"}))
            continue
        try:
            req    = LookupRequest(value=value, type_hint=ioc_type)
            result = lookup(req, db=db, current_user=current_user)
            results.append(result)
        except Exception as e:
            results.append(LookupResult(value=value, detected_type=ioc_type,
                                        errors={"batch": str(e)}))
    return results
