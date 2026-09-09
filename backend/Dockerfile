# ============================================================
# Flower Market API — Multi-stage Production Dockerfile
# ============================================================
#
# Build:  docker build -t flowermarket-api .
# Run:    docker run -p 4000:4000 --env-file .env.production flowermarket-api
#
# Stages:
#   1. deps    — install ALL dependencies (including dev for build)
#   2. prune   — reinstall with --omit=dev for production
#   3. runtime — minimal image with only production code
# ============================================================

# ---- Stage 1: install dependencies ----
FROM node:20-bookworm-slim AS deps

WORKDIR /app

# Copy package files first for layer caching (npm ci only reruns when
# package-lock.json changes, not on every source edit)
COPY package.json package-lock.json ./

# Install everything (devDependencies included for any build steps)
RUN npm ci --ignore-scripts

# ---- Stage 2: prune to production-only ----
FROM node:20-bookworm-slim AS prune

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./

# Remove devDependencies — the runtime image carries only what the app needs
RUN npm prune --omit=dev --ignore-scripts

# ---- Stage 3: runtime ----
FROM node:20-bookworm-slim AS runtime

# Security: run as non-root
RUN groupadd -r fm && useradd -r -g fm -d /app -s /sbin/nologin fm

WORKDIR /app

# Copy pruned node_modules and source
COPY --from=prune /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY scripts/seed-default-tenant.js ./scripts/

# Create storage directory for local media (dev fallback)
RUN mkdir -p storage/local && chown -R fm:fm /app

# Labels for container metadata
LABEL org.opencontainers.image.title="Flower Market API"
LABEL org.opencontainers.image.description="Multi-tenant flower marketplace backend"
LABEL org.opencontainers.image.vendor="Flower Market"
LABEL org.opencontainers.image.source="https://github.com/Venkatsai346/flowermarket"

# Environment defaults (overridable at runtime)
ENV NODE_ENV=production
ENV PORT=4000

# Health check — hits the lightweight /healthz endpoint
# 30s interval, 10s timeout, 3 retries, 40s startup grace
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD node -e "fetch('http://localhost:${PORT}/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

# Expose the API port
EXPOSE 4000

# Switch to non-root user
USER fm

# Start the API (production: no nodemon, no watch)
CMD ["node", "src/server.js"]
