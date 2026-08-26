# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 — build: full dependencies, compiling the front end and the server.
# ---------------------------------------------------------------------------
FROM node:25-slim AS builder

# Needed whenever a native module (better-sqlite3, argon2, sharp) has no prebuilt
# binary for this platform and has to be compiled.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /build

# The manifests first: as long as they do not change, Docker reuses the cache of
# the install step, which is by far the slowest one.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/ packages/

RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 2 — production dependencies only.
# ---------------------------------------------------------------------------
FROM node:25-slim AS deps

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
# Stage 3 — final image.
# ---------------------------------------------------------------------------
FROM node:25-slim AS runtime

# OCI metadata. `org.opencontainers.image.source` is what ties the published image
# to its repository on GHCR — without it the package page shows neither README nor
# license, and nothing connects a running container to the code it executes.
# `version` and `revision` are passed by the release workflow; a local build leaves
# them at `dev` and `unknown`, which tells a hand-built image apart from a
# published one.
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="lukarn" \
  org.opencontainers.image.description="Self-hosted photo and video gallery for a Google Drive account" \
  org.opencontainers.image.source="https://github.com/cr0cK/lukarn" \
  org.opencontainers.image.documentation="https://github.com/cr0cK/lukarn/blob/main/deploy/README.md" \
  org.opencontainers.image.licenses="AGPL-3.0-only" \
  org.opencontainers.image.version="${VERSION}" \
  org.opencontainers.image.revision="${REVISION}"

# ffmpeg prepares the videos whose codec no browser decodes (D99). It weighs about
# 250 MB in the image — the entry price, and the only one. Without it the server
# still starts: it says so at startup, and those videos stay downloadable as
# before.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini ffmpeg \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# The same build argument the labels carry, handed to the process this time: it is
# what the interface prints under "Powered by" and what the update check compares
# against. A local build leaves it at `dev`, which is never compared to anything —
# no build outside a release is ever told it is out of date (D260815).
ENV APP_VERSION=${VERSION}
ENV CONFIG_PATH=/app/config/albums.yaml
ENV DATA_DIR=/app/data
ENV CACHE_DIR=/app/cache
ENV WEB_DIR=/app/packages/web/dist
ENV PORT=8080
ENV HOST=0.0.0.0
# Image decoding, file reads and argon2 all share libuv's thread pool. At its
# default size of four, a handful of renders fills it and a thumbnail already in
# cache waits behind them — measured at 2 s on the 95th percentile. The server
# sets this value itself when it is missing; fixing it here makes it visible to
# whoever operates the instance.
ENV UV_THREADPOOL_SIZE=16

WORKDIR /app

# Production dependencies: the root store, plus the per-package symlinks. Copied
# wholesale — a package with no production dependency has no `node_modules`, and a
# targeted copy would fail on its absence.
COPY --from=deps /build/node_modules ./node_modules
COPY --from=deps /build/packages ./packages

COPY --from=builder /build/packages/shared/dist ./packages/shared/dist
COPY --from=builder /build/packages/server/dist ./packages/server/dist
COPY --from=builder /build/packages/web/dist ./packages/web/dist
COPY package.json pnpm-workspace.yaml ./

# The volumes are mounted by docker-compose; creating the mount points beforehand
# keeps them from belonging to root once mounted.
RUN mkdir -p /app/data /app/cache /app/config && chown -R node:node /app

USER node
EXPOSE 8080

# tini reaps zombie processes and relays SIGTERM, so that the server's graceful
# shutdown is actually triggered.
ENTRYPOINT ["/usr/bin/tini", "--"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/main.js"]
