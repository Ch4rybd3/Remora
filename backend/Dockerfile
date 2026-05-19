# ── Backend Dockerfile ────────────────────────────────────────────────────────
# Build context is the project ROOT (not backend/).
# docker-compose passes context: . so all paths below are relative to remora/

FROM python:3.12-slim

# System libraries required by C-extension packages
# (cryptography, lxml, lief, some volatility3 plugins, …)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libffi-dev \
    libssl-dev \
    libxml2-dev \
    libxslt1-dev \
    libmagic1 \
    file \
    && rm -rf /var/lib/apt/lists/*

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

EXPOSE 8000

CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--log-level", "info"]
