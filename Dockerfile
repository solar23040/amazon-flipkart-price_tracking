# syntax=docker/dockerfile:1

# --- frontend build: Angular app ---
FROM node:22-bookworm-slim AS frontend-build
ENV NPM_CONFIG_CACHE=/root/.npm
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- backend build: TypeScript -> dist ---
FROM node:22-bookworm-slim AS backend-build
ENV NPM_CONFIG_CACHE=/root/.npm
# better-sqlite3 ships prebuilds; the toolchain is a fallback in case it must compile
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

# --- runtime: backend serves the built frontend ---
FROM node:22-bookworm-slim
WORKDIR /app
# sqlite3 CLI powers consistent backups (scripts/backup-db.sh)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates sqlite3 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=backend-build /app/backend /app/backend
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist
COPY scripts /app/scripts
RUN chmod +x /app/scripts/*.sh

# PORT must match fly.toml http_service.internal_port
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/prices.db \
    LOG_DIR=/data/logs \
    FRONTEND_DIST=/app/frontend/dist/frontend \
    SCHEDULER_ENABLED=true

EXPOSE 8080
CMD ["node", "/app/backend/dist/index.js"]
