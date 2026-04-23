#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "  ██████╗ ███████╗███╗   ███╗ ██████╗ ██████╗  █████╗"
echo "  ██╔══██╗██╔════╝████╗ ████║██╔═══██╗██╔══██╗██╔══██╗"
echo "  ██████╔╝█████╗  ██╔████╔██║██║   ██║██████╔╝███████║"
echo "  ██╔══██╗██╔══╝  ██║╚██╔╝██║██║   ██║██╔══██╗██╔══██║"
echo "  ██║  ██║███████╗██║ ╚═╝ ██║╚██████╔╝██║  ██║██║  ██║"
echo "  ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝"
echo "  DFIR Case Management Platform"
echo ""

# Kill any previous instances on these ports
kill_port() {
  local port=$1
  local pid
  pid=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "[cleanup] Killing process on port $port (PID $pid)…"
    kill -9 "$pid" 2>/dev/null || true
  fi
}

kill_port 8000
kill_port 5173

# ── Backend ────────────────────────────────────────────────
cd "$ROOT/backend"

if [ ! -d ".venv" ]; then
  echo "[backend] Creating virtual environment…"
  python3 -m venv .venv
fi

source .venv/bin/activate

pip install -r requirements.txt -q --disable-pip-version-check

echo "[backend] Starting FastAPI on :8000…"
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# ── Frontend ───────────────────────────────────────────────
cd "$ROOT/frontend"

echo "[frontend] Installing npm packages…"
npm install --silent

echo "[frontend] Starting Vite on :5173…"
npm run dev &
FRONTEND_PID=$!

# ── Summary ────────────────────────────────────────────────
echo ""
echo "  ✓ Backend  → http://localhost:8000"
echo "  ✓ Frontend → http://localhost:5173"
echo "  ✓ API Docs → http://localhost:8000/docs"
echo ""
echo "  Backend PID : $BACKEND_PID"
echo "  Frontend PID: $FRONTEND_PID"
echo ""
echo "  Press Ctrl+C to stop everything."
echo ""

# Graceful shutdown on Ctrl+C
cleanup() {
  echo ""
  echo "[shutdown] Stopping Remora…"
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

wait "$BACKEND_PID" "$FRONTEND_PID"
