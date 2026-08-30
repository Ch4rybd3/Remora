# ── Backend Dockerfile ────────────────────────────────────────────────────────
# Build context is the project ROOT (not backend/).
# docker-compose passes context: . so all paths below are relative to remora/

FROM python:3.12-slim

# System libraries required by C-extension packages
# (cryptography, lxml, lief, some volatility3 plugins, …)
# DEBIAN_FRONTEND: tshark's postinst asks whether non-root users may capture
# packets, which would hang the build waiting on debconf.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libffi-dev \
    libssl-dev \
    libxml2-dev \
    libxslt1-dev \
    libmagic1 \
    file \
    # ── CTI network tools (used by /api/v1/cti/command) ──────────────────
    whois \
    dnsutils \
    # ── PCAP dissection (services/pcap.py) ───────────────────────────────
    # ~200 MB, mostly libwireshark. Ships the same dissectors as Wireshark,
    # so captures get proper application-layer decoding (HTTP, DNS, TLS, SMB).
    tshark \
    # ── Archive extraction fallbacks (services/archives.py) ──────────────
    # p7zip-full provides /usr/bin/7z (7z, RAR5, zstd tarballs); unar is the
    # rarfile backend for legacy RAR archives.
    p7zip-full \
    unar \
    && rm -rf /var/lib/apt/lists/*

# ── .NET 9 runtime ────────────────────────────────────────────────────────────
# The Eric Zimmerman tools are framework-dependent .NET builds; this is what
# runs them. The runtime alone, not the SDK: nothing here compiles anything, and
# the SDK is several times the size.
#
# Installed from Microsoft's package feed rather than the dotnet-install script
# so it is a normal apt package with normal updates.
# The Debian release is read from the image rather than hardcoded: the base
# moved from 12 to 13, and a pinned "12" in this URL installs a source list for
# the wrong release, which fails several steps later as "unable to locate
# package" with nothing pointing at the cause.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    wget ca-certificates \
    && . /etc/os-release \
    && wget -q "https://packages.microsoft.com/config/debian/${VERSION_ID}/packages-microsoft-prod.deb" \
         -O /tmp/packages-microsoft-prod.deb \
    && dpkg -i /tmp/packages-microsoft-prod.deb \
    && rm /tmp/packages-microsoft-prod.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends dotnet-runtime-9.0 \
    && rm -rf /var/lib/apt/lists/*

# The parsers run with no writable home. Without this .NET tries to create one
# for its first-run sentinel and exits before reading a single artifact.
ENV DOTNET_CLI_HOME=/tmp \
    DOTNET_NOLOGO=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1

# ── Parser sandbox account ────────────────────────────────────────────────────
# Eric Zimmerman parsers run as this user, never as root. It owns nothing, has
# no login shell and no home: everything it may write is a per-run scratch
# directory handed to it at execution time. See backend/app/services/sandbox.py.
RUN useradd --system --no-create-home --shell /usr/sbin/nologin remora-parser

# ── Dependency layer (cached unless requirements.txt changes) ─────────────────
WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# ── Application source ────────────────────────────────────────────────────────
COPY backend/  ./backend/
COPY templates/ ./templates/
COPY samples/   ./samples/

# Switch to the directory uvicorn will treat as the package root
# (mirrors `cd backend && uvicorn app.main:app` from start.sh)
WORKDIR /app/backend

# /app/data is mounted as a Docker volume at runtime.
# All sub-directories (evidences, note_images, chainsaw, …) are created
# automatically on first startup by main.py and the individual routers.

# Build identity, surfaced by GET /api/v1/version. .git is excluded from the
# build context, so the values have to be passed in:
#   docker build --build-arg REMORA_COMMIT=$(git rev-parse --short HEAD) ...
ARG REMORA_COMMIT=unknown
ARG REMORA_BUILT_AT=unknown
ENV REMORA_COMMIT=${REMORA_COMMIT} \
    REMORA_BUILT_AT=${REMORA_BUILT_AT}

EXPOSE 8000

CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--log-level", "info"]
