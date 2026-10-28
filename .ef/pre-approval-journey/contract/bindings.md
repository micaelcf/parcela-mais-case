# Bindings

The house rules every slice codes against. Feature-specific delta on top of `AGENTS.md`.

## Gate commands

| Gate                      | Command                                                                               | Notes                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Format + lint + typecheck | `vp check` · `vp run typecheck`                                                       | oxfmt + oxlint (type-aware, `typeCheck: true` via tsgolint); `typecheck` = `tsc --noEmit` on TypeScript 7 (native `tsgo` compiler)            |
| Tests                     | `vp test`                                                                             | Bundled Vitest 5.0.5 on Node. First tests in the repo; no `test` block exists yet                                                             |
| Build                     | `vp build`                                                                            | nitro `bun` preset → `.output/server/index.mjs` + `.output/public/`                                                                           |
| Ops                       | `vp run doctor` · `vp run up` · `vp run up --prod` · `vp run prune` · `vp run deploy` | `package.json` scripts (uncached), running `bun scripts/ops/<name>.ts`                                                                        |
| DB                        | `vp run db:generate` · `vp run db:migrate`                                            | drizzle-kit 1.0.0-rc.5 generates; `db:migrate` runs `scripts/ops/migrate.ts` (drizzle + pg-boss + queues), never `drizzle-kit migrate`/`push` |

Never run `npm` in the repo (`devEngines` pins bun 1.4.4). Install with `vp install` / `bun add`.

## Pinned versions (exact, no ranges)

`drizzle-orm@1.0.0-rc.5` · `drizzle-kit@1.0.0-rc.5` · `typebox@1.4.3` · `elysia@2.0.0-rc.0` · `@elysia/eden@2.0.0-rc.0` · `pg-boss@12.38.0` · `typescript@7.0.2` (the Go-native compiler; owner decision 2026-10-28. Every `typescript` dependent in the tree is an optional peer with a range that admits 7, and nothing calls the removed JS compiler API).
Elysia peers to add explicitly: `exact-mirror`, `openapi-types`. Remove: `zod`, `@faker-js/faker`, `@tanstack/match-sorter-utils` (demo-only), Vercel add-on.
UI: `@base-ui/react`, shadcn base style deps (`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`), `recharts` (charts), `sonner` (toasts).

## Runtime rules

- Code under `src/` uses Web standards and `node:*` only. **No `Bun.*`, no `bun:*` imports** (it must run under `vp dev`/`vp test` on Node and under Bun in containers).
- `scripts/ops/**` may use Bun APIs and Bun Shell (`import { $ } from "bun"`); they run only under Bun.
- Elysia 2 route signature is `(path, hook, handler)` or `(path, handler)`. The 1.x order throws at registration. `resolve`/`mapResolve` don't exist; v2 `derive` runs after validation. Scope hooks with a prefixed plugin instance (`new Elysia({ prefix })` + `.use()`).
- Every local URL uses the host `localhost`, never `127.0.0.1` (Podman/WSL publishes on IPv6 loopback only on this machine).

## Path aliases and file naming

- Canonical alias: **`#/*` → `./src/*`** (`package.json:5-7` imports + `tsconfig.json` paths). Vite/Vitest resolve it through the bundler. Bun running TS directly (worker, migrate, ops scripts) resolves the extensionless `#/x` only through `tsconfig.json` `paths`, so the runtime image ships `tsconfig.json` (amended 2026-10-28, implementation: package `imports` alone gave "Cannot find module" in the container).
- Exception: vendored shadcn files under `src/components/ui/**` keep the CLI's `@/` imports. Don't hand-edit them except to change tokens. No other file imports with `@/`.
- Files: `kebab-case` with a role suffix that says what the file is: `*.table.ts`, `*.relations.ts`, `*.repository.ts`, `*.service.ts`, `*.routes.ts`, `*.dto.ts`, `*.adapter.ts`, `*.port.ts`, `*.job.ts`, `*.plugin.ts`, `*.test.ts`, `*.int.test.ts`. React components are `PascalCase.tsx`. Full layout in [layout.md](layout.md).
- Formatting: oxfmt defaults (double quotes, semicolons, 2 spaces). `src/routeTree.gen.ts` is excluded from fmt and lint.

## Test conventions

- Import from **`vite-plus/test`** (`describe`, `it`, `expect`, `vi`). Importing from `vitest` fails the `vite-plus/prefer-vite-plus-imports` lint rule.
- **Unit tests** (`*.test.ts`, co-located): pure logic with no DB and no network. CPF, Price, breaker derivation, adapter mapping, TypeBox→Standard Schema adapter, list-query parsing.
- **Integration tests** (`*.int.test.ts`): real Postgres from the compose `postgres` service (`localhost:5432`).
  - The `integration` Vitest project's global setup (`test/integration/setup/global-setup.ts`) creates `test_<run>_tpl` per run, applies the real drizzle migrations, the pg-boss schema and the queues with `#/server/infra/db/migrate.ts` (portable; `scripts/ops/migrate.ts` is a thin Bun entry over it), and drops every `test_<run>_*` database at teardown.
  - A setup file (`test/integration/setup/file-db.setup.ts`) clones that template into `test_<run>_<n>` for **each test file** and points `DATABASE_URL` at it before the file imports app code. Files are isolated, so global state (breaker windows, kill switches, rate limits) never leaks between files.
  - Integration env defaults (set by the project, overridable per file before a dynamic import): `NODE_ENV=test`, `SIMULATION_CONTROLS=true`, `SIMULATOR_TIME_SCALE=0.2`, `CONSULTATION_DEADLINE_MS=2000`, `SIMULATOR_DELTA_FAILURE_RATE=0.3`, test-only PII keys and backoffice credentials. Timing claims use a fixed 1000 ms grace (the finalizer's pg-boss polling bound), not a scaled one.
  - Setup data **only through real code**: repositories, services, the Elysia app via `app.handle(new Request("http://localhost/api/..."))`, the worker via `createWorker({ lenderRegistry: testLenderRegistry })` (`signatures.md`). No test may import the DB client or a table object; a lint override on `**/*.int.test.ts` enforces it. Reading for assertions goes through repositories, except the RF-503 plaintext scan, which reads `information_schema` with a raw `pg` client.
  - Lender HTTP adapters get `fetch = appFetch` (the simulator behind the real app). Timing comes from env, never from mocks of the clock in integration tests.
  - Unique inputs per test (CPF from `cpfCheckDigits`, a distinct `X-Forwarded-For`) instead of cleanup.
- **E2E** (final phase): Playwright Test, `test/e2e/*.spec.ts`, run by `vp run e2e` (`playwright test`) against a running stack at `E2E_BASE_URL` (default `http://localhost:3000`, dev stack with `SIMULATION_CONTROLS=true`). Chromium only.
- A test proves a behaviour named in a PRD id; name it after the behaviour, not the function.

## Environment variables

Server env is validated at boot by `src/server/infra/env/server-env.ts`: `createEnv({ isServer: true, server: {...}, runtimeEnv: process.env })`, TypeBox through the Standard Schema adapter with `coerce: true`. No client env module exists: the browser has no env keys (the UI reads runtime flags from `GET /api/config`); add `src/lib/env/client-env.ts` on `import.meta.env` when the first `VITE_*` key appears (2026-10-28, implementation).

| Var                                                          | Type / default                                                                                                    | Used by                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `DATABASE_URL`                                               | postgres URL, required                                                                                            | app, worker, migrate, tests            |
| `PII_HMAC_KEY`                                               | base64, 32 bytes, required                                                                                        | CPF blind index, IP hash               |
| `PII_ENCRYPTION_KEY`                                         | base64, 32 bytes, required                                                                                        | CPF AES-256-GCM                        |
| `PII_KEY_VERSION`                                            | int ≥ 1, default 1                                                                                                | `cpf_key_version` written              |
| `BACKOFFICE_USERNAME`                                        | string, required                                                                                                  | login                                  |
| `BACKOFFICE_PASSWORD_HASH`                                   | `scrypt:<N>:<r>:<p>:<saltB64>:<hashB64>`, required (`:` not `$`: Bun's and Compose's env-file loaders expand `$`) | login                                  |
| `BACKOFFICE_SESSION_SECRET`                                  | ≥ 32 chars, required                                                                                              | Elysia cookie signing                  |
| `SIMULATION_CONTROLS`                                        | boolean, default `false`                                                                                          | scenario picker + API gate             |
| `LENDER_BASE_URL`                                            | URL, default `http://localhost:3000/api/simulator/lenders`                                                        | worker adapters                        |
| `CONSULTATION_DEADLINE_MS`                                   | int, default `10000`                                                                                              | deadline                               |
| `SIMULATOR_TIME_SCALE`                                       | number in (0,1], default `1`                                                                                      | simulator latency multiplier           |
| `SIMULATOR_DELTA_FAILURE_RATE`                               | number in [0,1], default `0.3`                                                                                    | Delta 500 rate in NORMAL               |
| `RATE_LIMIT_PATIENT_MAX` / `RATE_LIMIT_PATIENT_WINDOW_HOURS` | int, default `5` / `24`                                                                                           | D22 (thresholds = RFC O2, provisional) |
| `RATE_LIMIT_IP_MAX` / `RATE_LIMIT_IP_WINDOW_MINUTES`         | int, default `30` / `60`                                                                                          | D22 (RFC O2)                           |
| `GIT_SHA`                                                    | string, default `"dev"`                                                                                           | `/api/health`                          |
| `APP_DOMAIN`                                                 | host, optional                                                                                                    | Caddy site address (RFC O1)            |
| `NODE_ENV`                                                   | `development \| production \| test`                                                                               | Elysia production error shape          |

`.env.example` lists every var with a dev-safe value. `.env.local` is gitignored and holds real local values.
