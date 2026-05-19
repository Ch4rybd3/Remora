# Remora — DFIR Case Management Platform

Remora is a self-hosted, dark-themed incident response platform designed for security analysts. It centralises case management, forensic artefact analysis, IOC tracking, MITRE ATT&CK mapping, and report generation in a single interface.

![Dashboard](mitre_matrix_preview.png)

---

## Features

| Category | Capabilities |
|---|---|
| **Case management** | Cases with severity, TLP, status, tags, analyst assignment |
| **IOC tracking** | IP, domain, hash, email, URL — bulk import, case binding |
| **Evidence management** | File upload (up to 500 MB), evidence notes, chain of custody |
| **Forensic artefact analysis** | EVTX (Chainsaw), MFT, USN journal, Prefetch, Browser artefacts, Registry hives, Binary analysis |
| **Timeline** | Cross-artefact event timeline with pin-to-timeline workflow |
| **MITRE ATT&CK** | Technique mapping, Navigator layer export, visual matrix (ATT&CK v19) |
| **Attack graph** | Interactive ReactFlow-based kill-chain graph |
| **CTI lookup** | VirusTotal + AbuseIPDB enrichment per IOC |
| **Reports** | DOCX / Markdown export with template tags (`{{ioc_table}}`, `{{mitre_matrix_img}}`, …) |
| **Knowledge base** | Shared markdown notes with wikilinks and image paste |
| **Playbooks** | Reusable investigation checklists |
| **Audit log** | Full action trail per case |
| **Dashboard** | KPI cards, MTTR, activity chart, analyst workload, SVG donut charts |
| **Multi-user** | JWT auth, per-user roles, timezone preference |

---

## Quick Start — Docker (recommended)

> **Requirements:** Docker Engine 24+ and Docker Compose v2.  
> Works on Linux, macOS, and Windows (Docker Desktop). No other dependencies needed.

### 1. Clone & configure

```bash
git clone https://github.com/your-org/remora.git
cd remora

cp .env.example .env
```

Open `.env` and set the two required values:

```dotenv
# Generate with: python3 -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY=your_random_hex_key_here

# Password for the default admin account
DEFAULT_ADMIN_PASSWORD=change_me_strong_password
```

### 2. Build & launch

```bash
docker compose up --build
```

The first build takes ~2–3 minutes (Python and Node dependencies). Subsequent starts are fast.

### 3. Open the app

```
http://localhost
```

Log in with **admin** / the password you set in `DEFAULT_ADMIN_PASSWORD`.

The API documentation (Swagger UI) is available at:

```
http://localhost/api/v1/docs
```

---

## Configuration

All configuration is done through environment variables. Copy `.env.example` to `.env` and adjust as needed.

| Variable | Required | Default | Description |
|---|---|---|---|
| `SECRET_KEY` | **Yes** | — | JWT signing key. Generate with `python3 -c "import secrets; print(secrets.token_hex(32))"`. Changing this invalidates all active sessions. |
| `DEFAULT_ADMIN_PASSWORD` | No | `admin` | Password for the built-in `admin` account created on first startup. |
| `PORT` | No | `80` | Host port exposed by nginx. Change to `8080` if port 80 is taken. |
| `CORS_ORIGINS` | No | `http://localhost` | Comma-separated list of allowed CORS origins. Only relevant if you access the FastAPI backend directly from a different origin. |

### Changing the port

```dotenv
PORT=8080
```

```bash
docker compose up -d
# App now available at http://localhost:8080
```

### Running behind a reverse proxy (Nginx / Traefik / Caddy)

The frontend container already runs nginx internally. Expose it through your proxy on whatever domain you want. Set `CORS_ORIGINS` only if the frontend and backend are on different origins (they aren't in the default setup — nginx proxies everything through the same origin).

---

## Stopping & managing the stack

```bash
# Stop containers (data is preserved in the named volume)
docker compose down

# Stop and wipe all data (WARNING: irreversible)
docker compose down -v

# View logs
docker compose logs -f

# View backend logs only
docker compose logs -f backend

# Restart after a code change
docker compose up --build -d
```

---

## Data persistence

All runtime data lives in the `remora_data` Docker volume:

```
remora_data/
├── remora.db          ← SQLite database (cases, users, IOCs, …)
├── evidences/         ← Uploaded evidence files
├── note_images/       ← Images pasted into case notes
├── knowledge-assets/  ← Knowledge base attachments
├── chainsaw/          ← Chainsaw binary & Sigma rules (if configured)
└── mitre/             ← MITRE ATT&CK technique cache
```

To back up your data:

```bash
docker run --rm \
  -v remora_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/remora_backup_$(date +%Y%m%d).tar.gz -C /data .
```

To restore:

```bash
docker run --rm \
  -v remora_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/remora_backup_YYYYMMDD.tar.gz -C /data
```

---

## Optional integrations

### Chainsaw (EVTX analysis)

Chainsaw is **not bundled** in the Docker image. To enable EVTX scanning:

1. Download the [Chainsaw](https://github.com/WithSecureLabs/chainsaw) binary for Linux (the container OS).
2. Place the binary and your Sigma rules directory inside the `remora_data` volume:
   ```bash
   docker cp chainsaw remora-backend:/app/data/chainsaw/chainsaw
   docker cp sigma_rules/ remora-backend:/app/data/chainsaw/rules/
   ```
3. Set the paths in `.env`:
   ```dotenv
   CHAINSAW_BIN_PATH=/app/data/chainsaw/chainsaw
   CHAINSAW_RULES_PATH=/app/data/chainsaw/rules
   ```
4. Restart: `docker compose restart backend`

### VirusTotal & AbuseIPDB (CTI enrichment)

Configure API keys directly in the app: **Settings → Connectors**.  
No `.env` changes needed.

---

## Development Setup (without Docker)

> **Requirements:** Python 3.12+, Node.js 20+

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Create a minimal .env (or copy the root one)
echo "SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(32))')" > .env

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API available at `http://localhost:8000`  
Swagger UI at `http://localhost:8000/docs`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App available at `http://localhost:5173`

### One-command dev launcher (Linux / macOS)

```bash
cp .env.example .env   # fill in SECRET_KEY
chmod +x start.sh
./start.sh
```

Starts backend on `:8000` and Vite dev server on `:5173` in parallel, with graceful Ctrl+C shutdown.

---

## Project Structure

```
remora/
├── backend/
│   ├── app/
│   │   ├── main.py          ← FastAPI app, startup, router registration
│   │   ├── config.py        ← Settings (pydantic-settings, .env)
│   │   ├── models/          ← SQLAlchemy models
│   │   ├── routers/         ← API routes (one file per feature)
│   │   └── schemas/         ← Pydantic request/response schemas
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/             ← Typed API clients (one per feature)
│   │   ├── components/      ← Reusable UI components & forensic explorers
│   │   ├── pages/           ← Top-level page components
│   │   ├── context/         ← React contexts (Auth, Timezone)
│   │   └── types/           ← Shared TypeScript types
│   ├── package.json
│   └── Dockerfile
├── templates/               ← Default case templates (YAML)
├── samples/                 ← Sample artefacts for testing
├── nginx.conf               ← nginx config (SPA + API proxy)
├── docker-compose.yml
├── .env.example
└── start.sh                 ← Dev launcher (Linux/macOS)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3.12, FastAPI, SQLAlchemy 2, SQLite, pydantic-settings v2 |
| **Frontend** | React 18, TypeScript, Vite, TanStack Query, Tailwind CSS, Tiptap, ReactFlow |
| **Auth** | JWT (python-jose), bcrypt |
| **Forensics** | evtx, duckdb, lief, capstone, volatility3, python-docx, matplotlib |
| **Serving** | nginx 1.27 (SPA + reverse proxy), uvicorn |
| **Deployment** | Docker multi-stage build, Docker Compose |

---

## License

Private / internal project. All rights reserved.
