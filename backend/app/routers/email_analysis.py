import hashlib
import re
from email import policy
from email.header import decode_header, make_header
from email.parser import BytesParser
from typing import Optional

from fastapi import APIRouter, UploadFile, File

from ..schemas.email_analysis import EmailAnalysisResult, HeaderItem, AttachmentItem, EmailWarning

router = APIRouter(prefix="/artifacts/email", tags=["artifacts"])

# Key headers with analyst-facing descriptions (English)
KEY_HEADERS: dict[str, str] = {
    "From": "Declared sender address. May be spoofed — always cross-check with Return-Path and authentication results.",
    "Reply-To": "Address where replies will be sent. A mismatch with From is a common phishing indicator.",
    "Return-Path": "Bounce address set by the sending MTA. Should share the same domain as From.",
    "To": "Primary recipient(s) of the message.",
    "CC": "Carbon-copy recipients.",
    "Subject": "Subject line of the email.",
    "Date": "Date and time the message was composed, as declared by the sender.",
    "Message-ID": "Unique identifier assigned by the originating MTA. Useful for cross-referencing logs.",
    "Received": "SMTP relay chain — each hop adds a Received header. Read bottom-to-top to trace the actual path.",
    "X-Originating-IP": "IP address of the original sender's client, added by the first receiving server.",
    "X-Forwarded-To": "Address the message was forwarded to by the server.",
    "X-Mailer": "Mail client or software used to compose the message. May reveal attacker tooling.",
    "User-Agent": "Alternative to X-Mailer. Identifies the email client or library.",
    "DKIM-Signature": "Cryptographic signature proving the message body and selected headers were not modified after signing.",
    "Authentication-Results": "Summary of SPF, DKIM, and DMARC checks performed by the receiving server.",
    "Received-SPF": "Result of the Sender Policy Framework check. 'fail' or 'softfail' indicates domain spoofing.",
    "ARC-Authentication-Results": "Authenticated Received Chain — preserves auth results across legitimate forwarding hops.",
    "ARC-Seal": "Cryptographic seal protecting the ARC chain integrity.",
    "DMARC-Filter": "Result of the DMARC policy check applied by the receiving server.",
    "X-Spam-Status": "Spam classification result from the receiving server's filter.",
    "X-Spam-Score": "Numeric spam score. Higher values indicate higher spam probability.",
    "X-Spam-Flag": "Simple YES/NO spam flag set by the filter.",
    "List-Unsubscribe": "Unsubscribe mechanism declared by the sender. Presence indicates bulk mail.",
    "Content-Type": "MIME type of the message body (e.g. text/html, multipart/mixed).",
    "MIME-Version": "Version of the MIME standard used to encode the message.",
    "Precedence": "Message priority hint (bulk, list, junk). Commonly set by mailing lists.",
    "X-Google-DKIM-Signature": "Google's internal DKIM signature, present on Gmail-routed messages.",
    "X-MS-Exchange-Organization": "Microsoft Exchange routing and policy metadata.",
    "X-Originating-Auth": "Authenticated user identity recorded by the originating server.",
}

def _decode_header_value(raw: str) -> str:
    """Decode RFC 2047 encoded header value (=?charset?Q/B?...?=) to plain unicode."""
    try:
        return str(make_header(decode_header(raw)))
    except Exception:
        return raw


# Regex to extract URLs from text/html content
_URL_RE = re.compile(
    r'https?://'                    # scheme
    r'[a-zA-Z0-9\-._~:/?#\[\]@!$&\'()*+,;=%]+'  # path/query
    , re.IGNORECASE
)

# Also extract href/src attribute values separately (for HTML)
_HREF_RE = re.compile(r'(?:href|src)=["\']?(https?://[^\s"\'<>]+)', re.IGNORECASE)

# Email address extraction
_EMAIL_RE = re.compile(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}')


_EMAIL_ADDR_RE = re.compile(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}')

def _extract_email(raw: str) -> str:
    """Extract the bare email address from a header like 'Display Name <addr@domain>'."""
    m = _EMAIL_ADDR_RE.search(raw)
    return m.group(0).lower() if m else raw.strip().lower()

def _domain(addr: str) -> str:
    """Return the domain part of an email address (lowercased)."""
    return addr.split('@', 1)[-1] if '@' in addr else ''

def _compute_warnings(
    from_raw: str,
    reply_to_raw: str,
    return_path_raw: str,
    all_headers: list[HeaderItem],
) -> list[EmailWarning]:
    warnings: list[EmailWarning] = []

    from_email   = _extract_email(from_raw)
    from_domain  = _domain(from_email)

    # ── 1. Reply-To ≠ From ────────────────────────────────────────────────────
    if reply_to_raw:
        rt_email  = _extract_email(reply_to_raw)
        rt_domain = _domain(rt_email)
        if rt_email and rt_email != from_email:
            level = "critical" if rt_domain != from_domain else "high"
            warnings.append(EmailWarning(
                level=level,
                title="Reply-To differs from From",
                detail=(
                    f"Replies will be sent to {rt_email} instead of {from_email}. "
                    "This is a classic phishing technique — the victim responds to the attacker's address "
                    "while the email appears to come from a legitimate sender."
                ),
            ))

    # ── 2. Return-Path domain ≠ From domain ───────────────────────────────────
    if return_path_raw:
        rp_email  = _extract_email(return_path_raw)
        rp_domain = _domain(rp_email)
        if rp_domain and from_domain and rp_domain != from_domain:
            warnings.append(EmailWarning(
                level="high",
                title="Return-Path domain differs from From domain",
                detail=(
                    f"From domain: {from_domain} — Return-Path domain: {rp_domain}. "
                    "A mismatch often indicates spoofing or third-party relay abuse. "
                    "Cross-check with SPF and DMARC results."
                ),
            ))

    # Build a quick lookup of header values by name (lowercase)
    header_map: dict[str, list[str]] = {}
    for h in all_headers:
        header_map.setdefault(h.name.lower(), []).append(h.value.lower())

    # ── 3. SPF fail / softfail ───────────────────────────────────────────────
    spf_values = header_map.get('received-spf', []) + header_map.get('authentication-results', [])
    spf_fail   = any(('spf=fail' in v or 'spf=softfail' in v) for v in spf_values)
    spf_none   = any('spf=none' in v for v in header_map.get('authentication-results', []))
    if spf_fail:
        warnings.append(EmailWarning(
            level="high",
            title="SPF check failed",
            detail=(
                "The sending server is not authorised to send email on behalf of the From domain. "
                "'fail' means a hard SPF failure (spoofing detected). "
                "'softfail' is a softer indication but still suspicious."
            ),
        ))
    elif spf_none:
        warnings.append(EmailWarning(
            level="medium",
            title="SPF record missing (SPF=none)",
            detail=(
                f"The domain {from_domain} has no SPF record published in DNS. "
                "Anyone can send email appearing to come from this domain without authentication."
            ),
        ))

    # ── 4. DKIM fail / missing ────────────────────────────────────────────────
    auth_results = ' '.join(header_map.get('authentication-results', []))
    dkim_headers = header_map.get('dkim-signature', [])
    if 'dkim=fail' in auth_results:
        warnings.append(EmailWarning(
            level="high",
            title="DKIM signature invalid",
            detail=(
                "The DKIM signature failed verification. "
                "This means the message body or signed headers were tampered with after signing, "
                "or the signature was forged."
            ),
        ))
    elif not dkim_headers and 'dkim=pass' not in auth_results:
        warnings.append(EmailWarning(
            level="medium",
            title="No DKIM signature",
            detail=(
                "This email has no DKIM signature. "
                "Without DKIM, it is impossible to verify that the message was not modified in transit "
                "or that it was genuinely sent by the stated domain."
            ),
        ))

    # ── 5. DMARC fail ────────────────────────────────────────────────────────
    if 'dmarc=fail' in auth_results:
        warnings.append(EmailWarning(
            level="critical",
            title="DMARC policy failed",
            detail=(
                "DMARC validation failed — neither SPF nor DKIM alignment passed. "
                "The domain owner's published policy was violated. "
                "This strongly suggests spoofing or a misconfigured legitimate sender."
            ),
        ))

    return warnings


def _extract_urls(text: str) -> list[str]:
    """Extract unique URLs from text, prioritising href/src attributes in HTML."""
    found: dict[str, None] = {}
    for url in _HREF_RE.findall(text):
        url = url.rstrip(').,;\'\"')
        found[url] = None
    for url in _URL_RE.findall(text):
        url = url.rstrip(').,;\'\"')
        found[url] = None
    return list(found)


def _decode_part(part) -> str:
    try:
        raw = part.get_payload(decode=True)
        if not raw:
            return ""
        charset = part.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace")
    except Exception:
        return ""


def _get_bodies(msg) -> tuple[str, str]:
    """Return (plain_text, html_text) extracted from the message."""
    plain_parts: list[str] = []
    html_parts: list[str] = []

    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain" and part.get_content_disposition() != "attachment":
                plain_parts.append(_decode_part(part))
            elif ct == "text/html" and part.get_content_disposition() != "attachment":
                html_parts.append(_decode_part(part))
    else:
        ct = msg.get_content_type()
        if ct == "text/plain":
            plain_parts.append(_decode_part(msg))
        elif ct == "text/html":
            html_parts.append(_decode_part(msg))

    return "\n".join(plain_parts), "\n".join(html_parts)


def _get_body_text(msg) -> str:
    """Concatenate all text/* parts into a single string for URL extraction."""
    plain, html = _get_bodies(msg)
    return plain + "\n" + html


@router.post("/analyze", response_model=EmailAnalysisResult)
async def analyze_email(file: UploadFile = File(...)):
    raw = await file.read()
    msg = BytesParser(policy=policy.compat32).parsebytes(raw)

    # ── Headers ──────────────────────────────────────────────────────────────
    all_headers: list[HeaderItem] = []
    key_headers: list[HeaderItem] = []
    seen_key: set[str] = set()

    for name, value in msg.items():
        desc = KEY_HEADERS.get(name)
        is_key = name in KEY_HEADERS
        decoded_value = _decode_header_value(str(value)).strip()
        item = HeaderItem(
            name=name,
            value=decoded_value,
            description=desc,
            is_key=is_key,
        )
        all_headers.append(item)
        # Keep ALL occurrences of key headers (e.g. multiple Received)
        if is_key:
            key_headers.append(item)

    # ── Body text for URL extraction and display ──────────────────────────────
    body_plain, body_html = _get_bodies(msg)
    body_text = body_plain + "\n" + body_html
    urls = _extract_urls(body_text)

    # ── Attachments ──────────────────────────────────────────────────────────
    attachments: list[AttachmentItem] = []
    for part in msg.walk():
        disp = part.get_content_disposition() or ""
        ct = part.get_content_type()
        # Treat explicit attachments AND inline non-text parts as attachments
        if disp.lower() == "attachment" or (
            disp.lower() == "inline" and not ct.startswith("text/") and ct != "multipart/mixed"
        ):
            filename = part.get_filename() or f"unnamed.{ct.split('/')[-1]}"
            payload = part.get_payload(decode=True) or b""
            sha256 = hashlib.sha256(payload).hexdigest()
            attachments.append(AttachmentItem(
                filename=filename,
                content_type=ct,
                size=len(payload),
                sha256=sha256,
            ))

    from_addr    = _decode_header_value(str(msg.get("From",        "") or "")).strip()
    reply_to     = _decode_header_value(str(msg.get("Reply-To",   "") or "")).strip()
    return_path  = _decode_header_value(str(msg.get("Return-Path","") or "")).strip()

    warnings = _compute_warnings(from_addr, reply_to, return_path, all_headers)

    return EmailAnalysisResult(
        subject=_decode_header_value(str(msg.get("Subject", "") or "")).strip(),
        from_addr=from_addr,
        to_addr=_decode_header_value(str(msg.get("To", "") or "")).strip(),
        reply_to=reply_to,
        return_path=return_path,
        date=_decode_header_value(str(msg.get("Date", "") or "")).strip(),
        key_headers=key_headers,
        all_headers=all_headers,
        urls=urls,
        attachments=attachments,
        warnings=warnings,
        body_plain=body_plain or None,
        body_html=body_html or None,
    )
