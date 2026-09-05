"""
Single source of truth for the Remora version.

Bumped by release-please when a release pull request is merged into `main`.
Never edit by hand — see docs/CONVENTIONS.md section 3.
"""
from __future__ import annotations

import os
import subprocess
from functools import lru_cache

# x-release-please-start-version
__version__ = "0.3.0"
# x-release-please-end


@lru_cache(maxsize=1)
def build_info() -> dict[str, str]:
    """Version, commit and build date, for GET /api/v1/version."""
    return {
        "version": __version__,
        "commit": os.environ.get("REMORA_COMMIT") or _git_sha() or "unknown",
        "built_at": os.environ.get("REMORA_BUILT_AT", "unknown"),
    }


def _git_sha() -> str | None:
    """Short SHA when running from a checkout. None inside a built image."""
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=2,
        ).strip()
    except Exception:
        return None
