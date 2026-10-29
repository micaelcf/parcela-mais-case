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

## Stage 5 — audit round 1 (2026-10-28, reviewer agent, range `fa5b38d..d56f475`)

Verdict **FAIL**: 0 blockers · 2 major · 4 minor · 2 nits · 7 questions. Full report: `agent://Stage5AuditRound1` (copy at `local://audit-round-1.md`).

- A1 major (RF-502): public view exposes `attempts[].maxApprovableCents` = income × 10 on a NORMAL Alfa refusal; C99 only compares literals in forced scenarios.
- A2 major (PII): prod stack publishes Postgres 5432 on all interfaces with literal `parcela:parcela`.
- A3 minor (RF-217/218, D11): a forced-scenario attempt can claim the half-open probe.
- A4 minor (RF-108/614): same-key replay is checked before the patient lock, so a double submit at cap − 1 answers 429.
- A5 minor (RF-615): CPF-search results can page but not sort/filter; endpoint missing from Coverage.
- A6 minor (D2b): compose `environment` hard-codes `DATABASE_URL`, so a managed Postgres needs a compose edit.
- A7 nit (D5/RF-709): `docker builder prune -f` is not project-scoped. A8 nit: `NOT_FOUND`/`INTERNAL` missing from `api.md`.
- Questions: Q-1 real client IP under rootless Podman; Q-2 SSE through Caddy never exercised; Q-3 `Secure` cookie on plain-HTTP deploys; Q-4 RF-408 "identical body" while quoting; Q-5 CPF typed in the explorer's free-text search lands in the URL; Q-6 queue backlog up to 60 s stale; Q-7 lender-health rates include forced attempts.
- Remediation (orchestrator triage): fix A1–A8, Q-2 (prove through Caddy), Q-3 (`Secure` only when served over HTTPS), Q-5 (refuse CPF-shaped free text); record Q-1, Q-4, Q-6, Q-7 as owner questions in the RFC.

### Stage 5 remediation, round 1 (2026-10-28)

- A1 `210215b`: `maxApprovableCents` removed from the public view; C99 extended with NORMAL Alfa refusals (red: income × 10 appeared 11 times; green after). Residual RF-302/RF-502 tension → RFC O9.
- A2/A6/A7 `767771f`: prod stack publishes only Caddy; Postgres credentials from env (no default password for prod); `compose.dev.yaml` publishes 5432 for `vp run up`; `STACK_DATABASE_URL`; Docker build-cache prune skipped. `compose-stack.test.ts` guards it (red against the old compose file with 5 violations). Observed under `up --prod`: `postgres-1 5432/tcp` (unpublished), only Caddy on 8080/8443.
- A3 `b2bc3d7` then superseded by `fdd90d6`: forced attempts first settled `CIRCUIT_OPEN` under half-open; the post-fix E2E run then failed 10 tests because Delta's circuit had opened from ordinary NORMAL traffic (dev DB: 50 `CIRCUIT_OPEN`, 2 probes timing out). Decision (RFC D11 amendment): forced attempts bypass the automatic breaker entirely; the probe test now also proves an `ALL_APPROVE` approval while the circuit is OPEN.
- A4 `8b47996`: replay re-checked after the patient lock (red: `[202, 429, 429, 429, 429]`; green after).
- A5/Q-3/Q-5 `c349756`: search-by-cpf takes list controls in its body; `Secure` follows `APP_DOMAIN`; CPF-shaped free text refused in table search boxes.
- A8: `NOT_FOUND`/`INTERNAL` added to `api.md`. Q-1/Q-4/Q-6/Q-7 → RFC O5–O8.
- Q-2 `proxy.spec.ts` "streams snapshots through Caddy without buffering": `up --prod` + `E2E_BASE_URL=http://localhost:8080 vp run e2e test/e2e/proxy.spec.ts` → 2 passed.
- Flake seen once and fixed in the test wait (`fbf5e19`): abuse metrics read before every throttle outcome was recorded.
- Gates after remediation: `vp check` clean (222 files), `tsc` clean, `vp test` 45 files / 141 tests, `vp run e2e` 35 passed / 2 skipped (proxy specs, off-proxy).

## Stage 5 — verify round 2 (2026-10-28, reviewer, range `d56f475..4fac4a1`)

Verdict **FAIL**. Report: `agent://Stage5VerifyRound2` (copy `local://audit-round-2.md`). Fixed: A1, A2, A3 (as amended), A4, A7, A8, Q-2, Q-3. Partially fixed: A5 (Coverage rows stale), Q-5 (N2). Regressed: A6 → N1.

- N1 major: nested `${…}` inside a compose default breaks on podman-compose ≤ 1.5 (accepted by `doctor`).
- N2 minor: "Ana 5299822" (letters + partial CPF) still reaches the URL after the 400 ms pause.
- N3 minor: the remediation tests have no check ids; Coverage rows stale (list endpoints 4, error codes 13, breaker forced case, A4 gap now proven, C80 Docker wording, startup configurations 5, proxy rows).
- N4 minor: `api.md` still says `Secure` always; no D12/grill amendment for Q-3; PRD not amended for RF-216/705/709.
- N5 nit: docs say a managed Postgres needs only `STACK_DATABASE_URL`; `POSTGRES_PASSWORD` is still required.
- QN1: grill Q11's reopen condition fired (Delta trips its breaker on NORMAL traffic; real failure rate ≈ 0.62, P(≥16/20) ≈ 7 %, not 5.6×10⁻⁶). QN2: the proxy streaming proof doesn't record the content encoding.
- Round 3 plan: fix N1, N2 (+ an E2E guard for Q-5), docs for N3/N4/N5, record QN1 as O10 and correct D11's number, answer QN2 with an observed encoding.

### Stage 5 remediation, round 2 findings (2026-10-28)

- N1: `compose.yaml` app/worker/migrate take `DATABASE_URL: ${STACK_DATABASE_URL:-postgres://postgres:5432}` plus `PGUSER`/`PGPASSWORD`/`PGDATABASE`; node-postgres fills missing URL parts from `PG*` (`pg/lib/connection-parameters.js`), pg-boss/drizzle go through it. Verified by a throwaway `ConnectionParameters` script (bundled URL + PG* → parcela/s3cret/parcela@postgres; managed URL wins), `compose config` under docker-compose 5.1.3, and podman-compose 1.4.0's own `rec_subs` (old file reproduced the mis-parse). Guard C167 "never nests an interpolation inside a default": red against the old file (migrate/app/worker DATABASE_URL), green after.
- N2: `classifySearchText` looks at the trailing digit run whatever words precede it (1–10 → Enter only, 11+ → refused). Unit C168 red on "Ana 5299822" before; E2E C153 extended to the explorer "Buscar" box and confirmed to fail when the debounce guard is removed (`visited …?q=npdgnqprlp+4788624`), green restored.
- N3: checks C159–C168 added for every remediation test; Coverage rows refreshed (error codes 13 with `NOT_FOUND` C110 and `INTERNAL` C163 — new unit test; list endpoints 4; breaker × attempt kind; compose providers; startup configurations 5; proxy-crossing rows; A4 gap closed by C161).
- N4: RFC D12 + grill Q12 amended (Secure iff `APP_DOMAIN`); `api.md` cookie row; PRD RF-216/705/709 amended.
- N5: `compose.yaml`/`.env.example`/`ops.md`/`bindings.md` say `POSTGRES_PASSWORD` stays required with `STACK_DATABASE_URL`.
- QN1: RFC D11 correction (per-call failure ≈ 0.62, P(≥16/20) ≈ 7.0 %, computed) and owner question O10.
- QN2: C164 now runs per `Accept-Encoding` (Chromium's `zstd, br, gzip, deflate`, `gzip`, `identity`) and records the `Content-Encoding` Caddy chose.

## Stage 5 — verify round 3 (2026-10-28, reviewer, range `915c3ba..3980f27`)

Verdict **PASS** (`local://audit-round-3.md`): N1–N5 fixed, QN1 recorded (O10), QN2 answered; every code fix has a regression test that fails on revert. New: N6 minor (a consultation-id prefix with all-digit later groups, e.g. `019a2b3c-1234-7123-8123`, refused as a CPF), N7 nits (C163 cited RF-103; startup-configuration row claimed `migrate.ts` imports `server-env.ts`; `frontend.md` "digit-free text").

- Closed after the verdict: N6 — `classifySearchText` treats a UUID prefix past its first group holding a hex letter as text (CPF runs still checked first: `529-982-247-25` and an id prefix hiding 11 digits stay refused); C168 cases added, red on the old classifier per the reviewer's reproduction; `backoffice.spec.ts` 9 passed on the dev stack. N7 — docs corrected.
- Next: contract mode (`API_HANDOFF.md`, fact-checked by a fresh reviewer).

## Stage 5 — contract mode (2026-10-28)

- `docs/features/pre-approval-journey/API_HANDOFF.md` drafted from the code (agent `DraftApiHandoff`, payloads captured from the dev stack), linked from INDEX as superseding the design docs; RFC/PRD/INDEX statuses updated.
- Fact-check round 1 (`HandoffFactCheck1`, `local://handoff-factcheck-1.md`): NOT CLEAN — F1 blocking. Code defects found by the draft/fact-check were fixed in code with red-first tests, not just documented:
  - F1/F2 `9472e86`: a schema `pattern` keeps no regex flags (`UUID.source` dropped `/i`), so upper-case `Idempotency-Key`/`offerId` got 422. Now either case; lower-cased in the service (C170, C171; red: 422).
  - F6 `6d07833`: Elysia 2 throws an `ElysiaStatus` 415 for a body content type without a JSON parser; the errors plugin answered 500. Now 422 `VALIDATION` (C172; red: 500). Routes with a `parse` hook (throttle, backoffice guard) never reach Elysia's 415 and answer the generic `path: ""` 422; documented.
  - Draft D12 `1aac550`: throttle recorded malformed JSON as `INTERNAL`; now `VALIDATION` (C169; red: `[422,'INTERNAL']`).
- Fact-check round 2 (`HandoffFactCheck2`, `local://handoff-factcheck-2.md`): **CLEAN** (2 minor, 5 nits, all applied). R2-2 fixed in code: the SSE channel matched the raw path id, so an upper-case stream or choice fell back to the 2 s re-read; routes now lower-case `:id` (C173; red: `['lower','upper',false]`).
- Remaining documented divergences (no code change, owner/design): stateless logout (cookie replay works until expiry), undeclared extra fields in the backoffice detail, `patientFirstName` follows the patient's latest name, TypeBox English messages on string-vs-integer failures, form/multipart bodies accepted, no CORS/`Retry-After`, public simulator routes.
- Post-handoff review (2026-10-28): routes with their own `parse` hook (throttle on create/requote, backoffice guard on switch/search-by-cpf) never reach Elysia's 415, so `text/plain` there got the generic `path: ""` 422. `errors.plugin.ts` now answers any body whose content type Elysia doesn't parse with the same `Envie o corpo como JSON…` 422 on every route (C172 extended to a parse-hook route; red: 6 keys vs 5). Verified live on create, requote, choice, login, switch and search-by-cpf; JSON validation errors still carry `fields`. Non-Error throws now log their constructor name and JSON instead of `[object Object]`. Handoff collapsed to one behaviour.
- The abuse-metrics test flaked once more (1 in ~8 full runs, not reproduced on demand): its wait covered only the throttle counts, while it also asserts per-IP and per-patient rows that land after the response and are read against the app's clock. The wait now covers every asserted row; 3 consecutive full runs green.

### Phone validation (2026-10-28, user report)

- Before: `phone` passed any 10–11 digits (`00000000000`, DDD `00`, an 11-digit number not starting with 9, a 10-digit landline) though RF-101 and the field ask for a mobile; a `+55` paste was refused by the API and truncated by the mask.
- Now `src/lib/phone/phone.ts` (shared by the API schema, the form mask and patient storage): the 67 Anatel DDDs, then `9` + 8 digits; `+55`/`55` (12–13 digits) and a `0` trunk prefix are dropped; any other `+` country is refused; per-issue pt-BR messages (`DDD inválido`, landline, not-9, generic). Stored value: the 11 national digits. The pre-2016 "mobiles start with 7/8/9" rule from the report is obsolete (all mobiles are 9 + 8 digits since the 9th-digit migration), so it isn't applied.
- Proofs: C174 unit (a `+1 415…` number first passed as DDD 14 and was fixed), C175 API, backoffice detail stores `+55 (11) 98765-4321` as `11987654321`; browser check on `/cadastro/contato` showed each message and turned a pasted `+55 21 97654-3210` into `(21) 97654-3210`.

## Address step and design-system inputs (2026-10-28, user request) — slice S11

- User decisions (asked): address inside step 1 right after the birthdate; CEP lookup through our API (`GET /api/addresses/:cep`, ViaCEP behind it). RFC D27; PRD RF-101 amended, RF-111–RF-116 added. Mid-build user requirement: no native `type="date"`/`<select>` (RFC D28).
- Lead wrote the shared contract `src/lib/address/address.ts`; `AddressServer` (server, migration `20261028152050_patient_address`, ViaCEP adapter, cache, per-route throttle caps, integration tests with a fake ViaCEP) and `AddressUI` (step 1 fields, lookup hook, shadcn `calendar`/`popover` date picker, shadcn `Select`, backoffice detail, E2E with a routed fake) built in parallel.
- Found and fixed during the build:
  - Elysia never runs `parse` on a GET, so the throttle never counted lookups; `transform` now counts requests `parse` didn't (C189 was red first).
  - The dev server hung on every request after the first lookup. Root cause: `viacep.client.ts` matched TanStack Start's import protection (`**/*.client.*` denied in the server environment), so the module was stubbed; in-process integration tests don't run that Vite plugin. Renamed `viacep.adapter.ts`; layout rule recorded; E2E C190 hits the real route with no mock. (An agent had also attached a Node inspector to the hung process; it was not the cause: the hang reproduced on a clean restart.)
  - TypeBox's default `maxErrors` (8) truncated 422 `fields` and form errors now that signup has 14 fields: raised to 64 in `standard-schema.ts` (C192, red first: 8 of 12 paths); the UI's per-field fallback removed.
  - The generated shadcn calendar's day button never attaches its ref (arrow keys didn't move focus): `DatePicker` swaps in its own day button.
- Proofs: `vp check` clean (240 files), `tsc` clean, `vp test` 52 files / 191 tests, `vp run e2e` 44 passed / 4 skipped (proxy), `drizzle-kit generate` no changes, `vp build` with no import-protection denials; real ViaCEP through the dev server and through Caddy (`up --prod`): 200 Avenida Paulista in ~1.2 s, 404 `CEP_NOT_FOUND`, 422 at `cep`; proxy specs through Caddy 4 passed; browser check of step 1 (real lookup, focus on Número, masked date picker).
- Follow-ups after review (2026-10-28): abuse figures exclude CEP lookups again (`ABUSE_ROUTES`; C194 red first: the heavy IP's counts never settled at 7); file-name guard `src/server/server-file-names.test.ts` (C195; a planted `probe.client.ts` failed it); a GET with a stray `Content-Type` keeps its field errors (C196, red first). Handoff fact-check round 3 (`local://handoff-factcheck-3.md`): CLEAN, 4 minor + 2 nits, all applied; `patient.address` now observed live.
- Dev-environment note from the fact-check: consultations written by the prod-parity stack (`.env` PII keys) 500 in the dev backoffice detail (`.env.local` keys) because both share one Postgres; environment-only, not a contract issue.

## Signup UX round (2026-10-28, user request) — slice S12

- User asked (and answered two questions: e-mail **optional**; routes: directory layout for any path nested **two or more** levels): stepper redesign with semantic icons and React Bits Stepper motion; validation on blur/submit only; check table search debounce; optional e-mail; the date picker exactly as shadcn's base "Input" example with reusable UI in `src/components/ui`; route tree per the rule.
- Lead: route move (`cadastro/`, `consultas/`, `backoffice/` incl. `backoffice/consultas/`, `api/$.ts`; URLs unchanged; 20 E2E green right after), `src/lib/email` contract + tests, migration applied to dev. Agents: `EmailServer`, `SignupUX`, `DatePickerSearch`.
- Findings: the form validated `onChange` (errors mid-typing) — now blur only (TanStack's submit runs the blur validator; a separate `onSubmit` validator duplicated messages). Table search already debounced 400 ms by hand; moved to `@tanstack/react-pacer`, and a stale-filter bug (two quick filter changes could restore an old value) found by the new date-filter E2E and fixed. The registry calendar's day button doesn't attach its ref (arrow keys didn't move focus): one-line fix in `ui/calendar.tsx`, the only deviation from the registry. Concurrent agents' Playwright output inside the repo made Vite reload every page (fixed: output outside the repo).
- Gates: `vp check` clean (242 files), `tsc` clean, `vp test` 54 files / 210 tests, `vp run e2e` 50 passed / 4 skipped (proxy), drizzle-kit no changes, `vp build` with no import-protection denials, no `type="date"`/`<select>` outside `ui/`. Browser check: no error while typing a partial CPF, "CPF inválido" after blur; calendar popover pt-BR with month/year dropdowns and keyboard focus on a day; step 2 shows Paciente checked, Contato `aria-current="step"`, invalid e-mail flagged after blur.
- Follow-ups (2026-10-28): (1) user report: the calendar's month/year dropdowns opened and closed at once. Reproduced (focus jumped to the date input right after clicking a dropdown): clicks in the portalled `PopoverContent` bubble through React to shadcn's `InputGroupAddon`, whose `onClick` focuses the input on any non-button click, which closes the native select. Fixed in `ui/date-picker.tsx` (the popover content stops click propagation); shadcn's "Input" example doesn't use `captionLayout="dropdown"`, so it never hits this. E2E "keeps the calendar's month and year dropdowns open when clicked" red first ("Received: inactive"), green after (C207). (2) Route rule corrected to the user's intent (count of nested routes, not depth): `api.$.ts` and `consultas.$consultationId.tsx` back to flat files.

## Local HTTPS and backoffice access (2026-10-28, user request) — S5, S9

- User asked: dev served over Caddy at `https://parcela.localhost:8443` with automated root trust (`vp run up` stays one command); a way to reach the backoffice from the app; how the operator learns the credentials; whether it works across systems. Recorded as RFC D31, PRD RF-618, RF-712 and amendments to RF-701/RF-702.
- Agent `DevCaddyTrust` (ops): env-driven `Caddyfile` (explicit `*.localhost` redirect to `:{$HTTPS_PORT}`, since Caddy's automatic redirect assumes 443), `caddy-dev` service, shared CA in `.local/caddy` (`CADDY_DATA` for `up --prod`, named volume for `deploy`), per-OS trust (`scripts/ops/lib/local-ca.ts`), per-OS dev-server binding (`dev-binding.ts`; never every interface; `LENDER_BASE_URL` follows it), `{client_ip}` + `CADDY_TRUSTED_PROXIES` (dev `private_ranges`, prod none, RF-506 unchanged), `X-Parcela-Stack: dev`, `up` prints URL/backoffice/user and the dev password only when the hash verifies. `.env.example` hash regenerated for `senha-de-teste`. Lead review: the first binding (`vp dev --host` on all interfaces) exposed the dev app on Wi-Fi and Tailscale with a public dev password; sent back, fixed (WSL switch address on Windows; caddy-dev publishes on loopback).
- Lead: "Área da clínica" in the public header, "Ir para o cadastro" in the backoffice header (C217); forged-XFF proxy test gated on the dev header; C154 proof filter corrected (the test was renamed with the address).
- Windows trust prompt accepted once by the user; later `up`/`up --prod` silent. macOS and Linux (and Docker) are unit-tested only.
- Gates: `vp check` clean (254 files), `tsc` clean, `vp test` 58 files / 246 tests, `vp run e2e` over `https://parcela.localhost:8443` 55 passed / 1 skipped (forged-XFF, dev); proxy spec against `up --prod` 4 passed (agent run). One full run had "completes the journey by keyboard" fail once at a focus assertion; it passed alone and in the next full run: flaky, cause not established.

## Signup navigation, review and offer screen (2026-10-28, user report and request) — S12, S8

- User reported: a reload on step 2 kept step 2 with step 1 empty; the stepper header could not jump forward over filled steps. Asked: a review/summary before sending; placeholder lender logos with a logo + name look everywhere; offers grouped by lender in collapsibles (all open) with row hover; a confirmation dialog before the (final) choice. Recorded as RFC D32, PRD RF-120–RF-122, RF-411–RF-413, amendments to RF-101, RF-119, RF-406.
- Agents: `SignupFlow` (reachability rule from the form schema + CEP state, `<Navigate replace>` guard in the `/cadastro` layout, stepper `canSelect`/`lockedLabel`, Revisão step rendering `toSignupRequest`), `OffersUX` (`LenderLogo`/`LenderIdentity`, `--lender-*` theme tokens, `groupOffersByLender`, shadcn `collapsible` and `alert-dialog` via CLI, `OfferChoiceDialog`). Lead: keyboard journey through the review and the dialog (C228), records, C122 proof filter corrected (stale since the address round).
- Deviation accepted: the step being left is checked on the way, like "Próximo", so the next step is always clickable; arrivals by reload/URL/history use the strict rule.
- Follow-up (2026-10-28, user request): "Novo cadastro" in the consultation header (RF-414, C229). Found while checking it: `<Link className={buttonVariants(…)}>` skipped tailwind-merge, so the base `border-transparent` beat the variant's `border-border` (outline links had no border; `px-0` overrides could lose too); every call site outside `ui/` now wraps it in `cn()`.
- Follow-ups (2026-10-28): the `buttonVariants` merge moved into `ui/button.tsx` (reviewer: one fix at the source instead of seven call-site `cn()` wrappers; a documented local change to the registry file); the RF-414 PRD row, reported earlier but lost to a rejected batched edit, added. Theme toggle in both top bars (RFC D33, RF-812, C230–C232).

## Signup draft in sessionStorage (2026-10-28, owner decision) — S12

- Owner reversed grill Q14 / RFC D14 for reloads: RFC D34, PRD RF-123, RF-107 and RF-120 amended, API handoff storage guidance amended. `signup-draft.ts` (schema-checked, 30 minutes from the last edit, never `localStorage`, never the idempotency key); `useCepLookup` takes a restored answer so the address is neither looked up again nor refilled; the layout saves on field blur and `pagehide`, discards on a sent signup; the three "new signup" links discard too.
- Found while testing: expiry counted from the last save let `pagehide` re-saves keep an idle draft alive forever; now from the last edit (E2E with a pinned clock, C235).
- Infra incident during the run: the dev server process stayed alive but stopped listening on the WSL adapter address (Caddy 502, `dial tcp 192.168.160.1:3000: i/o timeout`); 21 E2E timed out. Restarting `vp run up` fixed it. Suspected adapter reset; not confirmed.
- Gates: `vp check`/`tsc` clean; unit 25 in the signup module; full E2E 70 passed / 1 skipped.

## tslog for every log (2026-10-28, user request) — S5

- `src/server/lib/log/logger.ts` now wraps tslog 5 (`createLogger`, same `logger.info(event, fields)` shape, so no call site changed); ops scripts log through `scripts/ops/lib/script-log.ts`; `up` colours `[app]` cyan and `[worker]` magenta, gives children `TSLOG_NAME` and, on a terminal, `FORCE_COLOR`; compose sets `TSLOG_TYPE=json` and `TSLOG_NAME` per service (merged into the shared env anchor: YAML merges are shallow, verified with `compose config`); tests run with `TSLOG_TYPE=hidden` and capture JSON lines through a transport instead of console spies. RFC D35, PRD RF-713 and RF-811 amended, C237.
- Checked: JSON shape and PII masking by hand; app and worker lines through tslog live; unit/integration 59 files / 256 tests; full E2E 70 passed / 1 skipped.

## Deliverables docs and UI polish (2026-10-28, user request) — S9, docs

- README rewritten for the case deliverables: `README.md` (pt-BR, primary) and `README.en.md`, short text, 6 mermaid diagrams each (all rendered with mermaid 11 to check syntax), 3 animated GIFs (`docs/assets/{journey,fan-out,live-updates}.gif`, agent `ReadmeGifs`, re-render with `bun docs/assets/src/render.ts`). Follow-ups chosen by the owner: public deploy, Delta breaker, observability, Better Auth, real lender integrations + webhooks. Decision ownership: agent `DecisionLedger` compiled 83 decisions from the grill/RFC/PRD/log, memory and the omp session archive; `docs/DECISOES.md` holds the bilingual table (counted by column: Micael 43, Micael → agente 6, Agente → aceito 18, Agente 16), the README a summary by theme (owner's choice).
- Side quests in parallel: backoffice section bar with icons and a sliding indicator (RF-619, C238); tables fetch their own rows (`use-server-list.ts`), page in place with `resetScroll: false`, and get loading/empty/error states (RF-620, C239–C240; root cause: router scroll reset + route loaders re-running on every search change); softer light theme (warm off-white background, stronger muted/border; all text pairs ≥ 5.3:1). PRD non-goals for draft persistence and deliverables marked as reversed/done.
- Follow-up (2026-10-28, user report): money inputs only formatted on blur, unlike CPF/CEP/date/phone. Not a regression: `MoneyField` was built as free text tidied on blur. Added `maskMoney` (pt-BR, same rules as `parseCentsInput`: comma starts the cents, dots placed by the mask, typed dots dropped, at most 9 integer digits); blur still pads the cents (C242).
