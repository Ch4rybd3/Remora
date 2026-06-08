"""
CTI network tools availability check.

Called once at startup. Logs the status of each tool used by the
/cti/command endpoint (whois, dig, nslookup).

These tools are expected to be installed via the Dockerfile:
  whois      → apt-get install whois
  dig        → apt-get install dnsutils
  nslookup   → apt-get install dnsutils

If a tool is missing, a warning is logged but the app continues to run —
individual commands will return a friendly "not available" message.
"""
from __future__ import annotations

import logging
import shutil
import subprocess

logger = logging.getLogger("remora.cti_tools")

_TOOLS = [
    ("whois",    ["whois", "--version"]),
    ("dig",      ["dig", "-v"]),
    ("nslookup", ["nslookup", "-version"]),
]


def _tool_version(argv: list[str]) -> str | None:
    """Return first stdout/stderr line of a version command, or None if not found."""
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=5)
        out = (r.stdout + r.stderr).strip().splitlines()
        return out[0] if out else "ok"
    except FileNotFoundError:
        return None
    except Exception:
        return None


def setup_cti_tools() -> dict[str, bool]:
    """
    Check availability of each CTI network tool.
    Returns a dict {tool_name: is_available}.
    """
    results: dict[str, bool] = {}
    missing: list[str] = []

    for name, argv in _TOOLS:
        # First check if it's in PATH at all
        if shutil.which(name) is None:
            logger.warning("[cti_tools] '%s' not found in PATH — commands using it will be unavailable", name)
            results[name] = False
            missing.append(name)
        else:
            version = _tool_version(argv)
            if version:
                logger.info("[cti_tools] %-12s available — %s", name, version[:60])
            else:
                logger.info("[cti_tools] %-12s available", name)
            results[name] = True

    if missing:
        logger.warning(
            "[cti_tools] Missing tools: %s. "
            "They should be installed via the Dockerfile (apt-get install whois dnsutils). "
            "CTI lookup commands for those tools will return an error message.",
            ", ".join(missing),
        )
    else:
        logger.info("[cti_tools] All network tools ready (whois, dig, nslookup)")

    return results
