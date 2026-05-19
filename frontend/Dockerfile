# ── Frontend Dockerfile (multi-stage) ────────────────────────────────────────
# Build context is the project ROOT (not frontend/).

# ── Stage 1: Build React app ──────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

# Install deps first (cache-friendly — only re-runs when package.json changes)
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --silent

# Copy source and build
COPY frontend/ ./
RUN npm run build
# Output: /build/dist

# ── Stage 2: Serve with nginx ─────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Replace default nginx config with our reverse-proxy + SPA config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built React assets
COPY --from=builder /build/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
