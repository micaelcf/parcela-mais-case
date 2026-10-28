# Fully qualified image names only (Podman short-name policy). Every stage carries the project
# label so its intermediate images count as this project's build cache (`vp run prune`/`deploy`).

# 1. deps: the full dependency tree, from the lockfile only.
FROM docker.io/oven/bun:1.4-alpine AS deps
LABEL com.parcela.project=parcela-mais-case
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

# 2. build: Vite+ runs on Node (D3), so Node with Bun copied in.
FROM docker.io/library/node:24-alpine AS build
LABEL com.parcela.project=parcela-mais-case
COPY --from=docker.io/oven/bun:1.4-alpine /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG GIT_SHA=dev
# `bun x` = `bunx` (the bunx symlink isn't copied, only the bun binary).
RUN bun x vp build

# 2b. production dependencies for the runtime (the worker and migrate run TS from src/).
FROM docker.io/oven/bun:1.4-alpine AS prod-deps
LABEL com.parcela.project=parcela-mais-case
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# 3. runtime: app (`.output`), worker (`src/`), migrate (`scripts/ops/migrate.ts` + `drizzle/`).
FROM docker.io/oven/bun:1.4-alpine AS runtime
LABEL com.parcela.project=parcela-mais-case
WORKDIR /app
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/.output ./.output
COPY src ./src
COPY drizzle ./drizzle
COPY scripts/ops ./scripts/ops
USER bun
EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]
