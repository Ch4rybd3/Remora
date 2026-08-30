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
