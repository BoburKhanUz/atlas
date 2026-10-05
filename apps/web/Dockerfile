# syntax=docker/dockerfile:1
# ATLAS web (Next.js standalone). Build context: apps/web

# ── deps + build ─────────────────────────────────────────────────────────────
FROM oven/bun:1.3-debian AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
COPY prisma ./prisma
# postinstall runs `prisma generate`
RUN bun install --frozen-lockfile

COPY . .
# Build needs a syntactically valid URL only; nothing connects at build time.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build \
    NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 atlas \
    && useradd --system --uid 1001 --gid atlas atlas \
    && mkdir -p /app/storage/uploads && chown -R atlas:atlas /app/storage

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    STORAGE_LOCAL_DIR=/app/storage/uploads

COPY --from=builder --chown=atlas:atlas /app/.next/standalone ./

USER atlas
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
