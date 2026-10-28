# Ops: compose, image, proxy, scripts

Verified on this workstation (2026-10-27): podman 6.0.2 rootless on WSL; `podman compose` delegates to **docker-compose v5.1.3** (so `depends_on.condition: service_completed_successfully` and `--wait` are honoured); bun 1.4.4; node 25.9.0. Published ports answer on `localhost`/`::1` only, not `127.0.0.1`.

## `compose.yaml` (one file; must work with `podman compose` and `docker compose`)

| Service    | Image                                  | Profile   | Notes                                                                                                                                                                                                                                                                                                               |
| ---------- | -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres` | `docker.io/library/postgres:18-alpine` | (default) | volume `pgdata`; healthcheck `pg_isready`; credentials `${POSTGRES_USER}`/`${POSTGRES_PASSWORD}`/`${POSTGRES_DB}` from env (no literal password); **no published port** in `compose.yaml`: `compose.dev.yaml` (dev only) publishes `${POSTGRES_PORT:-5432}:5432` with a dev password (amended 2026-10-28, audit A2) |
| `migrate`  | built `app` image                      | `prod`    | `bun scripts/ops/migrate.ts`; `depends_on: postgres: service_healthy`; `restart: "no"`                                                                                                                                                                                                                              |
| `app`      | built `app` image                      | `prod`    | `bun .output/server/index.mjs`; `depends_on: migrate: service_completed_successfully`; healthcheck via `bun -e "fetch('http://localhost:3000/api/health')…"`                                                                                                                                                        |
| `worker`   | built `app` image                      | `prod`    | `bun src/server/worker.main.ts`; same `depends_on` as `app`                                                                                                                                                                                                                                                         |
| `caddy`    | `docker.io/library/caddy:2-alpine`     | `prod`    | ports `${HTTP_PORT:-8080}:80`, `${HTTPS_PORT:-8443}:443`; mounts `./Caddyfile` read-only; volume `caddy_data`                                                                                                                                                                                                       |

Fully qualified image names only (Podman short-name policy). `env_file: .env` for app/worker/migrate. Inside compose, `DATABASE_URL` is `${STACK_DATABASE_URL:-postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}}` (a managed Postgres needs only `.env`, audit A6) and `LENDER_BASE_URL=http://app:3000/api/simulator/lenders`. Label every built image `com.parcela.project=parcela-mais-case`. In the prod configuration only `caddy` publishes host ports; `scripts/ops/lib/compose-stack.test.ts` fails otherwise.

## `Dockerfile` (multi-stage)

1. `deps`: `docker.io/oven/bun:1.4-alpine`, `bun install --frozen-lockfile`.
2. `build`: a Node image with Bun copied in (`COPY --from=docker.io/oven/bun:1.4-alpine /usr/local/bin/bun /usr/local/bin/bun`), because Vite+ runs on Node (D3). Runs `bunx vp build`; `ARG GIT_SHA`.
3. `runtime`: `docker.io/oven/bun:1.4-alpine`, with prod deps, `.output/`, `src/` (the worker runs TS), `drizzle/`, `scripts/ops/` and `package.json` (for `#/*` imports). `ENV GIT_SHA=$GIT_SHA NODE_ENV=production`.

Build stage 2 is B-grade: verify that `vp build` succeeds in that image during S-ops.

## `vite.config.ts` deltas

`nitro({ preset: "bun" })` (explicit; otherwise a Node build resolves `node`). Exclude `src/routeTree.gen.ts` from fmt and lint. Add the `test` block (globalSetup for the integration DB). Remove nothing else.

## `Caddyfile`

```caddy
{$APP_DOMAIN::80} {
	encode zstd gzip
	reverse_proxy app:3000 {
		flush_interval -1
		header_up X-Forwarded-For {remote_host}
		header_up X-Real-IP {remote_host}
	}
}
```

`header_up` without `+` **replaces** any client-supplied value. `flush_interval -1` streams SSE unbuffered. With `APP_DOMAIN` unset → plain HTTP on :80 (RFC O1).

## Ops scripts (`scripts/ops/*.ts`, Bun, local only, no SSH, no git fetch)

`lib/engine.ts` picks `podman` if found on PATH or at `%LOCALAPPDATA%\Programs\Podman\podman.exe`, else `docker`; `CONTAINER_ENGINE` overrides. Compose is invoked as `<engine> compose -f compose.yaml -p parcela-mais-case` for prod/deploy/prune, and with `-f compose.yaml -f compose.dev.yaml` for `vp run up` and `doctor`'s hint. Build-cache pruning runs only on Podman (label-scoped); on Docker it is skipped and reported, because BuildKit's cache carries no project label (audit A7).

| Command                           | Behaviour (exit ≠ 0 on any failed step)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vp run doctor`                   | Read-only report, one line per check with ✓/✗ and a fix hint: engine + compose provider version; `service_completed_successfully` support (provider = docker-compose ≥ 2 or podman-compose ≥ 1.2); bun version vs `devEngines` 1.4.4; `.env.local`/`.env` validates against the server env schema; `DATABASE_URL` host isn't `127.0.0.1`; DB reachable; pending drizzle migrations and pg-boss schema version; ports 3000/5432/`HTTP_PORT` free; on Linux, `/proc/sys/net/ipv4/ip_unprivileged_port_start` ≤ 80 when Caddy publishes 80/443. Changes nothing |
| `vp run up`                       | Dev: `compose up -d --wait postgres` → `bun scripts/ops/migrate.ts` → spawn `vp dev --port 3000` and `bun --watch src/server/worker.main.ts` in the foreground with prefixed logs; Ctrl-C stops both (Postgres keeps running)                                                                                                                                                                                                                                                                                                                                |
| `vp run up --prod`                | `compose --profile prod up -d --build --wait` → GET `http://localhost:${HTTP_PORT}/api/health` → print the URL                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `vp run prune`                    | Local reset: `compose --profile prod down -v --remove-orphans --rmi local`, then remove dangling images labelled `com.parcela.project=parcela-mais-case` and the build cache. No remote option                                                                                                                                                                                                                                                                                                                                                               |
| `vp run deploy`                   | Run **on the target host**: refuse if `git status --porcelain` is non-empty → `GIT_SHA=$(git rev-parse HEAD)` → `compose --profile prod build` → `up -d --wait` (migrate gates app/worker) → `/api/health` must return `sha == GIT_SHA` → then remove superseded labelled images and the build cache. A failed migration exits non-zero before app/worker start                                                                                                                                                                                              |
| `vp run backoffice:hash-password` | Read a password from stdin, print a `BACKOFFICE_PASSWORD_HASH` value (scrypt)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

`scripts/ops/migrate.ts`: drizzle `migrate(db, { migrationsFolder: "./drizzle" })`, then install/upgrade the pg-boss schema (`new PgBoss({ connectionString, migrate: true, supervise: false, schedule: false }).start()` then `.stop()`), then create queues and schedules from `queues.ts`. It's idempotent. App and worker start pg-boss with `migrate: false`.

## Worker process (`src/server/worker.main.ts`)

Boots env, `boss.start()`, then `work("lender.<code>", { batchSize: 1, localConcurrency: <=20 }, handler)` per lender, `work("consultation.finalize", …)`, `work("throttle.purge", …)`. On SIGTERM/SIGINT: `boss.stop({ graceful: true, timeout: 15000 })`, then close the pool. Verify the exact `work()` concurrency option name against `pg-boss@12.38.0` types in S-worker.
