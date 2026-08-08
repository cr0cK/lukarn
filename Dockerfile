# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Étape 1 — build : dépendances complètes, compilation du front et du serveur.
# ---------------------------------------------------------------------------
FROM node:24-slim AS builder

# Nécessaires si un module natif (better-sqlite3, argon2, sharp) n'a pas de
# binaire prébuilt pour cette plateforme et doit être compilé.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /build

# Les manifestes d'abord : tant qu'ils ne changent pas, Docker réutilise le
# cache de l'installation, qui est de loin l'étape la plus lente.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/ packages/

RUN pnpm build

# ---------------------------------------------------------------------------
# Étape 2 — dépendances de production seules.
# ---------------------------------------------------------------------------
FROM node:24-slim AS deps

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
# Étape 3 — image finale.
# ---------------------------------------------------------------------------
FROM node:24-slim AS runtime

# ffmpeg prépare les vidéos dont aucun navigateur ne décode le codec (D99). Il
# pèse environ 250 Mo dans l'image — le prix d'entrée, et le seul. Sans lui le
# serveur démarre quand même : il le signale au démarrage, et ces vidéos restent
# téléchargeables comme avant.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini ffmpeg \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV CONFIG_PATH=/app/config/albums.yaml
ENV DATA_DIR=/app/data
ENV CACHE_DIR=/app/cache
ENV WEB_DIR=/app/packages/web/dist
ENV PORT=8080
ENV HOST=0.0.0.0
# Le décodage d'images, les lectures de fichiers et argon2 partagent le pool de
# fils de libuv. À sa taille par défaut de quatre, quelques rendus le remplissent
# et une vignette déjà en cache attend derrière — mesuré à 2 s au 95e centile.
# Le serveur pose lui-même cette valeur si elle manque ; la fixer ici la rend
# visible à l'exploitation.
ENV UV_THREADPOOL_SIZE=16

WORKDIR /app

# Dépendances de production : le store racine, plus les liens symboliques par
# package. Copié en bloc — un package sans dépendance de production n'a pas de
# `node_modules`, et une copie ciblée échouerait sur son absence.
COPY --from=deps /build/node_modules ./node_modules
COPY --from=deps /build/packages ./packages

COPY --from=builder /build/packages/shared/dist ./packages/shared/dist
COPY --from=builder /build/packages/server/dist ./packages/server/dist
COPY --from=builder /build/packages/web/dist ./packages/web/dist
COPY package.json pnpm-workspace.yaml ./

# Les volumes sont montés par docker-compose ; créer les points de montage en
# amont évite qu'ils appartiennent à root une fois montés.
RUN mkdir -p /app/data /app/cache /app/config && chown -R node:node /app

USER node
EXPOSE 8080

# tini récolte les processus zombies et relaie SIGTERM, pour que l'arrêt
# gracieux du serveur soit réellement déclenché.
ENTRYPOINT ["/usr/bin/tini", "--"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/main.js"]
