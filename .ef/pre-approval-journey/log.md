# Log — pre-approval-journey

## Stage 3 — discovery (2026-10-27)

### Step 1: anchor check (`/ef:spec-drift`)

| #   | Claim (source)                                                                                                 | Verdict             | Evidence                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | TanStack Start 1.169.4, Router 1.170.46, Form 1.33.5, Table 9.3.1, React 19 (knowledge)                        | VERIFIED            | `package.json:26-30,35-36`                                                                                                     |
| 2   | Vite+ 1.3.0, `vite` aliased to vite-plus-core (knowledge)                                                      | VERIFIED            | `package.json:54-58`                                                                                                           |
| 3   | nitro beta registered as a Vite plugin (knowledge)                                                             | VERIFIED            | `package.json:33`, `vite.config.ts:9,24`                                                                                       |
| 4   | drizzle 0.45 on `pg`, `db` from `process.env.DATABASE_URL` (knowledge; grill Q23 `package.json:32,38`)         | VERIFIED            | `package.json:31-34,38`, `src/db/index.ts:1-5`; installed 0.45.4 / kit 0.31.11                                                 |
| 5   | example `todos` table only (knowledge)                                                                         | VERIFIED            | `src/db/schema.ts:3-7`                                                                                                         |
| 6   | env via t3 env-core + zod, `runtimeEnv: import.meta.env` (knowledge)                                           | VERIFIED, defective | `src/env.ts:1-39`; server vars read as undefined (pre-existing defect)                                                         |
| 7   | aliases `#/*` and `@/*` (knowledge)                                                                            | VERIFIED            | `tsconfig.json:7-10`, `package.json:5-7`                                                                                       |
| 8   | lint type-aware + `prefer-vite-plus-imports` error; staged `vp check --fix` (knowledge)                        | VERIFIED            | `vite.config.ts:12-20`, `.vite-hooks/pre-commit:1`                                                                             |
| 9   | bun 1.4.4 via `devEngines` (knowledge)                                                                         | VERIFIED            | `package.json:60-66`; local bun 1.4.4                                                                                          |
| 10  | Vercel target + add-on (knowledge, AD20)                                                                       | VERIFIED            | `vercel.json:1-4`, `.cta.json:21`                                                                                              |
| 11  | Elysia, Eden, pg-boss, Base UI, shadcn, TypeBox not installed (knowledge)                                      | VERIFIED            | `node_modules` listing                                                                                                         |
| 12  | `vp env` manages one Node runtime (grill Q3, C2)                                                               | VERIFIED            | `node_modules/vite-plus/docs/guide/env.md:3`                                                                                   |
| 13  | script vs task caching (AD2)                                                                                   | VERIFIED            | `node_modules/vite-plus/docs/guide/run.md:114-117`                                                                             |
| 14  | `vp` built-ins don't include doctor/up/prune/deploy (grill directive)                                          | VERIFIED            | `vp help`                                                                                                                      |
| 15  | test files import from `vitest` (RFC D19, grill Q19 evidence)                                                  | **CHANGED**         | `vite-plus/test` is the import (`docs/guide/test.md:13-16`); `vitest` imports fail lint (`vite.config.ts:18`). RFC D19 amended |
| 16  | `vp test` = bundled Vitest on Node (D3)                                                                        | VERIFIED            | `docs/guide/test.md`, `migrate.md:154` (Vitest 5.0.5)                                                                          |
| 17  | HTML anchors `:234 :235 :245 :246 :254 :264 :271 :281-286 :305-313 :343 :425 :458 :483 :503 :595-600 :680-699` | VERIFIED            | read each line of `jornada-credito-parcela-mais.html`                                                                          |
| 18  | `elysia-nazli` `src/index.ts:86` (grill Q22)                                                                   | N/A                 | other repository; verified at grill time via GitHub API                                                                        |
| 19  | External library claims (pg-boss, Elysia, drizzle, Vercel docs)                                                | N/A                 | not this repo; re-proven by probes in Step 2                                                                                   |

Counts: VERIFIED 16 (one also carries a pre-existing defect) · CHANGED 1 · MOVED 0 · FICTION 0 · N/A 2.
The CHANGED claim matches no `Would reopen if` condition (D19's is about runtime behaviour, not the import path), so it's a correction, not a reversal.

### Step 2: scout fan-out

Warranted: greenfield modules, so the changed files couldn't be named up front. Six disjoint axes, each with its own lens:

| Scout                    | Axis                                                                          | Lens                 |
| ------------------------ | ----------------------------------------------------------------------------- | -------------------- |
| ConventionsFrontendShell | conventions, root shell, SSR switch, env                                      | evidence-audit       |
| ElysiaEdenProbe          | Elysia 2 RC + Eden (SSE, abort, guards, cookies, errors), run on Node and Bun | pre-mortem           |
| DataLayerProbe           | drizzle 1.0 RC + pg-boss 12.38, live on Postgres 17/18                        | assumption-surfacing |
| ValidationBridgeProbe    | TypeBox → Standard Schema → TanStack Form / env-core, Vite env                | evidence-audit       |
| OpsInfraScout            | compose on Podman/Docker, nitro preset, Caddy                                 | pre-mortem           |
| UiKitScout               | shadcn on Base UI, tokens, Table v9                                           | second-order         |

Full reports: `agent://<name>` (session transcripts).

### Step 3: triage

**Scout claims corrected by the lead before use:**

- OpsInfraScout said no podman/docker and bun 1.2.4 → false (PATH issue in its shell). Re-checked: podman 6.0.2 at `%LOCALAPPDATA%\Programs\Podman`, compose provider docker-compose v5.1.3, bun 1.4.4, node 25.9.0.
- DataLayerProbe said "Podman doesn't forward ports to Windows localhost" → partially false. Re-tested: `localhost` and `::1` connect; only literal `127.0.0.1` is refused.

**Contradictions, ranked by consequence** (all resolved; see below):

1. `bigint` mode `"bigint"` breaks Elysia JSON both ways (500 / 422), against AD11 + D23 → AD11 amended (mode `"number"`).
2. SSE needs `sse()` per yield; Eden has no reconnect and doesn't cancel on `break`; server waits must race `request.signal` → D9 amended.
3. `src/env.ts` can't read server vars (pre-existing) → server env on `process.env`.
4. pg-boss LISTEN on a shared pool needs our own reconnect code → **grilled** (Q2 below).
5. Elysia hides 422 field details in production → root `onError(ValidationError)` mapper.
6. `drizzle-orm/typebox` maps `timestamp` → `Date`, which rejects ISO strings in request bodies → request DTOs override date/timestamp fields.
7. `defineRelationsPart` requires explicit `from`/`to` and barrel-equal keys → contract rule.
8. `vp check` red on the template (drizzle.config.ts TS2345, routeTree.gen.ts fmt) → pre-existing defects, fixed in S0.
9. `uuidv7()` SQL default needs Postgres 18 → JS-side uuidv7 (portable to 17).
10. Podman 127.0.0.1 refusal → use `localhost` everywhere (research, not a decision).

### Step 4: decisions

#### Discovery Q1 — How does code on Windows reach Postgres in Podman?

**Decision.** PIVOT: research in disguise. Retested: `localhost` and `::1` connect, and only `127.0.0.1` is refused. Every local URL uses `localhost`, and `doctor` flags `127.0.0.1`. No machine change.
**Evidence.** A: TCP probe against `postgres:18-alpine` with `-p 58432:5432`, five rounds: `127.0.0.1 ECONNREFUSED`, `::1 OK`, `localhost OK`.

#### Discovery Q2 — Who owns pg-boss's connections?

**Decision.** pg-boss owns a small pool (`max: 3`, `useListenNotify: true`, `migrate: false`). Drizzle keeps its pool. Transactional sends use `fromDrizzle(tx, sql)`.
**Why.** 1. Keeps LISTEN heartbeat and reconnect in pg-boss's tested code (`dist/db.js:158-290`). 2. Transactional send is independent of the constructor `db` (proven live). 3. Same driver, so D3's actual goal holds.
**Evidence.** A: DataLayerProbe live runs (rollback drops the job; wake-up 3 ms after commit).
**Dissent.** One shared pool is the leaner footprint and was D3's literal wording.
**Riskiest assumption.** 3 extra connections per process (app + worker = 6) fit the Postgres connection budget, including a future managed tier.
**Test.** `SELECT application_name, count(*) FROM pg_stat_activity GROUP BY 1` under `up --prod`.
**Would reopen if.** A managed Postgres tier caps connections below the app + worker total, or `DATABASE_URL` points to a transaction-mode pooler.
**Supersedes.** RFC D3 "sharing one pool with pg-boss".

#### Decisions taken by the lead (vetoable)

| #   | Decision                                                                                                                               | Evidence                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| L1  | Cents columns `bigint({ mode: "number" })`; rate `numeric(7,6)` string + pattern; Price as an exact BigInt rational, half-up           | A: probe 500/422 on bigint mode (AD11 amended)                                 |
| L2  | UUIDv7 generated in JS (`node:crypto`); compose image `postgres:18-alpine`; code runs on 17                                            | A: `uuidv7()` absent on PG 17.11                                               |
| L3  | No SSR via `defaultSsr: false`; shell still server-rendered, data never                                                                | A: `router-core/src/router.ts:448`, `createStartHandler.ts:1186-1205`          |
| L4  | SSE: `sse()` envelopes, one LISTEN client + in-memory fan-out, 2 s re-read, 15 s ping, client hook owns abort + reconnect with backoff | A: ElysiaEdenProbe facts 1-6                                                   |
| L5  | Validation errors → 422 problem+json `{ code: "VALIDATION", fields[] }` in every env                                                   | A: production 422 hides fields (probe fact 12-13)                              |
| L6  | pt-BR: `System.Locale.Set(pt_BR)` shared + `error` node annotations; adapter honours both                                              | A: ValidationBridgeProbe facts 9-10, 13                                        |
| L7  | Server env via `createEnv({ isServer, runtimeEnv: process.env })`; client env separate                                                 | A: probe fact 16-17                                                            |
| L8  | Backoffice session = Elysia native signed cookie `bo_session` (`user                                                                   | exp`), `InvalidCookie` → 401                                                   | A: probe fact 10 |
| L9  | Request DTOs: drizzle-derived, date/timestamp fields overridden to `YYYY-MM-DD` strings                                                | A: probe fact 15                                                               |
| L10 | `#/*` canonical; vendored shadcn `src/components/ui/**` keeps CLI `@/`                                                                 | B: shadcn CLI expects `@/` (docs `installation/tanstack`); repo uses `#/` only |
| L11 | Offer sorting in the browser over API values (offers aren't a server table); no money math client-side                                 | B: D25 "data tables" scope; D17/AD11                                           |
| L12 | Simulator time scale, deadline and Delta failure rate are env-configurable for tests (no clock mocks in integration tests)             | B: D20 real-code tests + RF-803 timing                                         |
| L13 | `INTEGRATION_ERROR` reason distinguishes an unreachable or garbled simulator from a lender 500                                         | A19 test (D19)                                                                 |
| L14 | Breaker half-open single probe guarded by `pg_advisory_xact_lock` + `breaker_probe` column                                             | B: D11 "one probe call"                                                        |
| L15 | Requote age recomputed at requote time; income and birthdate copied                                                                    | B: D15 frozen inputs per submission                                            |
| L16 | TanStack Query not added; loaders + Eden + router invalidation                                                                         | A: not installed (`package.json`)                                              |
| L17 | Vercel artifacts removed; `nitro({ preset: "bun" })` explicit                                                                          | A: nitro resolves `node` on a Node build (`_presets.mjs:1914`)                 |

### Step 5: contract

Written to `contract/` (8 files) and the requirement list to `checks.md`. RFC amended in place: header status, D3, D9, D19, D24, D25, AD11, pre-existing defects table. INDEX status updated.

## Stage 4 — implement (2026-10-28)

### Extract

- Checklist written: 11 slices (`slices/S0…S10`), 158 checks (C1–C158), every one of the 89 PRD ids cited (scripted check: 0 missing, 0 duplicate ids, 0 checks without a proof). Swept + Coverage in `verification.md`. Feature base `fa5b38d`.
- Contract additions: `contract/signatures.md` (cross-slice exports, written by the lead); `bindings.md` test conventions made concrete (per-run template DB + per-file clone, integration env defaults, E2E runner).
- Price reference table computed independently (exact rationals, half-up) and frozen into S2 before any code.

### Settled by the user mid-stage (not otherwise recorded outside Landing)

- Layout: no `shared` folders. `src/lib` = isomorphic cross-repo code; `src/server/infra` = infrastructure (env, db, http, queue, worker runtime, realtime); `src/server/lib` = in-process server code that's neither infra nor business (crypto, log, domain errors); `src/server/integrations/<system>` = external systems (lenders, with the simulator beside the adapters).
- DDD applies to the API tree only. The frontend follows TanStack Start + shadcn defaults at the `src/` root; feature components under `components/modules/<feature>/`, root `components/` = app shell/layout + `ui/`. Route loaders own reads; components never call the API (exceptions: SSE hook, mutation handlers). TanStack Query stays out.
- DTO files are `<module>.dto.ts` (replaces `*.schemas.ts` and `consultation-view.ts`).
- Worker: generic runtime in `infra/worker/run-worker.ts`, composition root `src/server/worker.ts`, entry `src/server/worker.main.ts`.
- Tests: unit co-located; integration under `test/integration/<module>/` with `test/integration/setup/`; E2E under `test/e2e/`.
- RFC O4 closed by the lead (vetoable): Playwright Test standalone (Landing row).

### S0 + S1 (lead, W0) — landed

- S0 `1d0905e`: C1–C5, C8 green (`vp test`), `vp check` green, built server smoke under Bun (`/api/health` 200 with the SHA, `/api/config`, unknown `/api/*` → 404 problem+json, `/` serves the pt-BR shell with no route markup).
- Amended while building (contract updated in place): `defaultSsr` lives in `src/start.ts` (`createStart`), not `createRouter`; the backoffice hash is `scrypt:N:r:p:salt:hash` because Bun's and Compose's env-file loaders expand `$` even in quotes (observed: Bun turned the value into `scrypt=/nT…`); no client env module (no `VITE_*` keys; flags come from `/api/config`); `src/routeTree.gen.ts` must be generated by the Start plugin (`vp build`/`vp dev`), not `tsr generate`, or it loses the Start `Register` block.
- S1: tables, relations parts and two migrations (`init` generated; `seed_lender_settings` via `drizzle-kit generate --custom`); `migrateDatabase` = drizzle + pg-boss schema + queues + purge schedule, idempotent (ran twice against dev DB). `compose.yaml` `postgres` service written by the lead in W0 so the harness has a database; S5 extends the file.
- RF-806 lint probe (C9): a scratch `test/integration/probe/probe.int.test.ts` importing `#/server/infra/db/client` and `#/server/modules/patient/db/patient.table` → `vp lint` reports `eslint(no-restricted-imports)` on both lines. Scratch file deleted.
- C10 at S1: `drizzle-kit generate` → "No schema changes, nothing to migrate".
- C11 green; the integration teardown leaves no `test_%` database behind (checked with `psql`).
- `LENDER_CODES` and the other enum value lists live in `src/lib/enums.ts` (isomorphic), consumed by `infra/db/enums.ts` (`pgEnum`); `lender.port.ts` imports them instead of declaring its own.

### W1 (S2, S3) — landed `d115306`, `ae2c7a2`

- Gates at the boundary: `vp check` clean (73 files), `tsc --noEmit` (TypeScript 7.0.2) clean, `vp test` 13 files / 44 tests green.
- Proof titles renegotiated (claim unchanged): Vitest `-t` is a regex, so titles with `R$` matched nothing. C20 → "matches the PDF formula for 10.000 reais at 2,49% in 12x"; C26 → "Gama refuses under 25 or above 20.000 reais".
- S3 choices: adapter HTTP plumbing in `integrations/lenders/lender-http.ts` (port file is contract-only, no re-exports); simulator answers an aborted request with an empty 499 instead of throwing; breaker "newest failure"/"newest call" both read `calledAt`, the 5-minute window cuts on `settledAt`; `DELTA_TIMES_OUT` only overrides Delta's latency (its rule still applies after the wait).
- Owner decision mid-stage: TypeScript 7.0.2 (native `tsc`) everywhere; `vp run typecheck` added; the `tsr` CLI and `tsr.config.json` removed; `db:migrate` runs `scripts/ops/migrate.ts`; `db:push`/`db:pull` removed (migrations are the only schema path).

### W2 (S4, S5) — landed `5bf44d9`, `e43d8d9` (+ `be3aa10`, `a759ffb`, `305f2f6`)

- Gates: `vp check` clean (123 files), `tsc --noEmit` clean, `vp test` 29 files / 88 tests green (unit + integration, parallel files on per-file DBs).
- Contract gaps found and closed by the lead: forced Delta outcomes capped at 4–8 s (else ~45 % of `DELTA_FAILS`/`NONE_APPROVE` time out, RF-214 can't hold 20/20; RFC D18 amended); adapter `fetch` typed `FetchLike` (Bun's `typeof fetch` adds `preconnect`); `src/` may not use `Bun`/`bun` (lint override).
- S4 choices: consultation row lock is `FOR NO KEY UPDATE` (a full `FOR UPDATE` deadlocked against offer inserts' FK share locks under parallel load); breaker gate decides lock-free first and takes the advisory lock only for skip/probe decisions; the settle step locks the consultation before counting PENDING attempts; SSE re-emits only changed views.
- S5 choices: `@types/bun` dev dependency (owner-approved via lead); Docker build-cache prune is `docker builder prune -f` (BuildKit cache can't be labelled); worker healthcheck = process alive.
- Runtime fixes at the boundary: the runtime image must ship `tsconfig.json` (Bun resolves extensionless `#/` imports only via `paths`; migrate failed "Cannot find module"); Caddy healthcheck uses `127.0.0.1:2019` inside the container (busybox wget tried `::1`); `setupTypebox()` in `app.ts` (bundled build dropped Elysia's TypeBox registration: every `/api/*` 500).
- RF-701 run (C85): `vp run up` → postgres healthy, "✓ database migrated", worker `worker.started`, Vite ready on :3000; `GET /api/health` 200; an `ALL_APPROVE` POST settled with 4 APPROVED, 12 offers, `settledAt − createdAt` 5152 ms; SSE first event `snapshot`.
- RF-702 run (C86, podman 6.0.2 + docker-compose 5.1.3): `vp run up --prod` → "✓ caddy, app, worker and postgres are healthy", "→ http://localhost:8080"; `GET :8080/api/health` 200; a `DELTA_FAILS` POST through Caddy settled in 5321 ms with Delta `UNAVAILABLE/LENDER_ERROR` and one `lender.call` line per lender in the worker log.
- RF-703 (C87): no `docker` CLI on this workstation (`where docker` empty) → Unproven here; the compose file uses only features docker-compose v5 (the provider Podman delegates to) already exercised.
- RF-704 run (C83, by S5): `vp run doctor` exit 0, 12 ✓ lines; `git status --porcelain`, project containers and volumes identical before/after.
- Safe real runs (S5): dirty-tree `vp run deploy` → exit 1 before build; `vp run prune --host ssh://box` → exit 2; `DOCKER_HOST=… deploy` → `RemoteCommandError`.

### W3 (S6) — landed `2503942`

- C89–C100 green on their own; backend integration folders (consultation, throttle, lender) 14 files / 48 tests green after capping integration `maxWorkers` at 4 (`d851028`): with unbounded parallel files, C76's 1.6 s Delta answer occasionally finalized as TIMEOUT against the 2 s deadline.
- S6 choices: throttle is a macro (`transform` before validation + `afterResponse`), contract amended; malformed-JSON bodies aren't counted (fail in the parser first); requote locks the patient with `consultationRepository.lockPatient` inside the shared create TX and lazily finalizes an overdue source before checking preconditions; IP cap counts per (ip, route); purge uses an injectable `now` for its retention proof; the privacy test uses a fixed CPF (`58637184553`) whose 3-digit windows don't collide with rate strings.
- Ops finding (W3): the dev stack (`vp run up`) and the prod-parity stack (`vp run up --prod`) share compose project `parcela-mais-case`, its `postgres` service and database `parcela`. Running both at once lets the prod worker take dev jobs, and with different PII keys in `.env` vs `.env.local` it fails them ("unable to authenticate data"). Run one or the other locally; the prod app/worker/caddy were stopped after the RF-702 proof.
- `4e6e6c1` malformed JSON → 422 `VALIDATION` (was 500); `ce7a036` the throttle counts in the route's `parse` stage, so malformed JSON counts toward the IP cap.

### W4 (S7, S8) — landed `b6db429`, `9d7ad64`

- Gates: `vp check` clean (189 files), `tsc --noEmit` clean, `vp test` 42 files / 129 tests green, `vp build` green. `cca103a`: an integration project with its own `maxWorkers` needs its own `sequence.groupOrder`, else a full `vp test` refuses to start.
- S7: the backoffice session is verified before validation (an internal `sessionReader` Elysia instance runs Elysia's own signed-cookie check on the `Cookie` header in `parse`/`transform`; cookies don't exist yet at that stage in Elysia 2), so unauthenticated requests with a bad body get 401, not 422. Cookie signing config lives on the root app (Elysia 2 reads it only there). Queue backlog comes from pg-boss stats cached up to 60 s. No server-side session revocation (D12). Response shapes: see `src/server/modules/backoffice/backoffice.dto.ts`.
- S8: shadcn CLI 4.23 `base-nova` on Base UI; its `cn()` comes from the `cn` package (not `clsx` + `tailwind-merge` as the contract listed), plus `@fontsource-variable/geist`, `next-themes`, `shadcn` (CSS) and `tw-animate-css`. Server 422 field errors are kept in the `cadastro` layout state (TanStack Form clears unmounted fields' errors). Browser walk-through of C122–C144 done by the builder against a separate DB; every flow behaved as claimed. C144 note: on the dev server TanStack devtools inject `data-tsd-source` on `<html>`, so the E2E spec asserts the `lang="pt-BR"` attribute, not the literal tag.
- RF-707 run (C81): scratch clone `../parcela-deploy-probe` (local `git clone .`, removed afterwards) with one extra committed migration `SELECT 1/0;` (committed with `--no-verify` inside the throwaway clone only, which has no `node_modules` for the hook). `bun scripts/ops/deploy.ts` there → migrate `Exited (1)` ("Failed query: … SELECT 1/0;"), compose "service \"migrate\" didn't complete successfully", deploy printed "✗ the stack did not come up healthy (a failed migration keeps app and worker stopped)", **exit 1**; `app`, `worker`, `caddy` left in state `Created` (never started). The dev DB still records only the 2 real migrations.

### W5 (S9) — landed `62164d0`

- Gates: `vp check` clean (CLI-owned `src/components/ui/**` now excluded from lint, still type-checked: `cc9b723`), `tsc --noEmit` clean, `vp test` 43 files / 133 tests green.
- Machine restart mid-wave killed the first S9 builder after it had only vendored `table`/`chart`/`switch`/`select`; a second builder resumed from that state.
- False alarm, recorded so nobody chases it: the S9 builder concluded that `.env` overrides `.env.local` because dev login took the `.env` password. Cause was the agent tool's persistent shell, which had 9 `.env` keys exported; launched with those unset, `vp run up` uses `.env.local` (`senha-de-teste` 204, `parcela-dev` 401) with `.env` present. Bun's own precedence (`.env.local` over `.env`) re-checked in a clean `env -i` shell.

### S10 — Browser smoke (C157, RF-808), 2026-10-28, lead, managed Chromium against `vp run up` (:3000)

- **Signup:** 3 steps (`/cadastro/paciente` → `/contato` → `/financeiro`), scenario picker shows 5 options (Normal + 4 forced). Found and fixed a real defect on the way: an error appearing on blur pushed "Voltar" 28 px down mid-click (`0d96e1c`, error line reserved); after the fix Voltar stays at y=826.5 before/after blur and one click goes back with the phone kept.
- **Live cards (`ALL_APPROVE`, R$ 10.000):** sampled every second: Alfa "aprovada" at ~2 s, Gama ~3 s, Beta ~4 s (R$ 6.000 = 60 %), Delta ~6 s; no navigation.
- **Choice:** "Escolher Alfa em 12x de R$ 974,28" → "Oferta escolhida"; after reload the Alfa 12x card still shows "Escolhida"; Beta rows carry "valor aprovado menor que o solicitado".
- **Requote (`NONE_APPROVE`, R$ 10.000):** cards "recusada · valor acima do limite" (Alfa) and "perfil não elegível" (others), suggestion "Simular com R$ 5.000,00"; clicking it → `POST …/requote` 202 → new `/consultas/<id>` with "valor solicitado R$ 5.000,00" settling live in NORMAL (Delta "indisponível" by deadline).
- **Backoffice:** login `operador` → "Painel" with volumes (R$ 443.000,00 requested / 39 consultations); exact CPF search `111.444.777-35` lists "Rui Prado" and the URL stays `/backoffice/consultas`; detail shows "CPF 111.444.777-35". Found and fixed a real defect: a stale `bo_session` (signed with the previous secret) made login answer 500 `InvalidCookie` (`db91b97`, regression test "logs in over a stale or forged session cookie").

### W6 (S10) — landed `1010fe2` (+ `0d96e1c`, `db91b97`, `32e0a26`, `0241ceb` proxy spec)

- E2E (C156, RF-807): `vp run e2e` against `vp run up` → **35 passed, 1 skipped** (the proxy spec, off-proxy) in 46.3 s; the builder ran it green 3× in a row before handing over, and the lead re-ran it once after the fixes below.
- Defects the E2E work and the browser smoke surfaced, all fixed with the failing check now green: blur errors shifting the "Voltar" button (C126, `0d96e1c`); login 500 with a stale `bo_session` (`db91b97` + integration regression); the table search debounce navigating back to the list after Enter + click (`32e0a26`).
- RF-506 (C155): `vp run up --prod` (podman) → `E2E_BASE_URL=http://localhost:8080 vp run e2e test/e2e/proxy.spec.ts -g "ignores a forged X-Forwarded-For"` → **1 passed** (31 creates, each with a different forged `X-Forwarded-For`; the 31st got 429 `IP_LIMIT`). The spec first skipped behind Caddy because it looked for `Server: Caddy`; Caddy sends `Via: 1.1 Caddy` on proxied responses, fixed in the spec.
- Final gates: `vp check` clean (220 files), `tsc --noEmit` clean, `vp test` 43 files / 134 tests green, `drizzle-kit generate` → "No schema changes" (C10).
- Proof wording: `vp run e2e -- <file>` forwards a literal `--` and Playwright then ignores the filters; every E2E proof now reads `vp run e2e <file> -g "<title>"`.
- Known non-requirement nit: `HEAD /api/*` answers 404 (the Start server route maps GET/POST/PUT/PATCH/DELETE only).
- Prod-parity app/worker/caddy stopped after the C155 run (they share the dev database).
