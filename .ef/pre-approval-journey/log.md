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
