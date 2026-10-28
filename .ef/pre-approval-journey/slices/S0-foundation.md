# S0 — the toolchain, env, validation bridge and an empty `/api` serve and pass the gates · ~22 files · est. ~9k

Builder: lead, inline (shared prerequisite of every other slice).

Owns: `package.json`, `bun.lock`, `vite.config.ts`, `tsconfig.json`, `.cta.json`, `vercel.json` (delete), `src/env.ts` (delete), `src/routes/about.tsx` (delete), `src/components/{Header,Footer,ThemeToggle,demo.FormComponents}.tsx` (delete), `src/hooks/demo.*` (delete), `src/data/demo-table-data.ts` (delete), `src/router.tsx`, `src/routes/__root.tsx`, `src/routes/api.$.ts`, `src/server/app.ts` (skeleton), `src/server/infra/env/**`, `src/lib/env/**`, `src/lib/validation/**`, `src/lib/list/**`, `src/server/infra/http/errors.plugin.ts`, `src/server/lib/errors/domain-error.ts`, `src/server/lib/log/**`, `src/server/modules/system/**`
Reads: contract/bindings.md, contract/layout.md, contract/api.md, contract/frontend.md

Non-goals: no feature module, no table, no UI component.

**C1** · RF-102 — `toStandardSchema` reports a refine failure on the `cpf` property as one issue with path `["cpf"]` and the node's `error` message, not on the root
Proof: `vp test src/lib/validation/standard-schema.test.ts -t "puts a refine failure on its field path"`

**C2** · RF-101 — a missing required property is reported at its own path (`["fullName"]`), with a pt-BR message
Proof: `vp test src/lib/validation/standard-schema.test.ts -t "re-homes required errors to the missing property"`

**C3** · RF-103 — with `NODE_ENV=production`, a body validation failure returns 422 `application/problem+json` with `code: "VALIDATION"` and `fields: [{ path: "cpf", message }]`
Proof: `vp test src/server/infra/http/errors.plugin.test.ts -t "keeps field details in production"`

**C163** · RF-103 — an unexpected error → 500 `application/problem+json` `{ code: "INTERNAL" }` whose body carries none of the error's message (added 2026-10-28, audit N3: error-code coverage)
Proof: `vp test src/server/infra/http/errors.plugin.test.ts -t "answers an unexpected error with 500 INTERNAL and no internals"`

**C4** · RF-708 — `GET /api/health` returns 200 `{ status: "ok", sha }` with `sha` equal to `GIT_SHA`
Proof: `vp test src/server/modules/system/system.routes.test.ts -t "reports the configured commit"`

**C5** · RF-215 — `GET /api/config` returns `{ simulationControls }` equal to the `SIMULATION_CONTROLS` env value, for both `true` and `false`
Proof: `vp test src/server/modules/system/system.routes.test.ts -t "exposes the simulation controls flag"`

**C6** · RF-616 — `parseListQuery` rejects a `sort` field and a filter param outside the endpoint allow-list with `VALIDATION` at path `sort` and at the param's name
Proof: `vp test src/server/infra/db/list-query.test.ts -t "rejects fields outside the allow-list"`

**C7** · RF-615 — `parseListQuery` defaults to `page=1`, `pageSize=20` and the endpoint's default sort, and rejects `page=0`, `pageSize=0` and `pageSize=101` with `VALIDATION`
Proof: `vp test src/server/infra/db/list-query.test.ts -t "applies page bounds and defaults"`

**C8** · (no RF; startup configuration) the server env refuses to load with a missing or short `PII_ENCRYPTION_KEY` and names the variable in the error
Proof: `vp test src/server/infra/env/server-env.test.ts -t "refuses an invalid PII key"`

Note: `list-query.ts` lands in S1 (it needs the drizzle columns); C6–C7 are proven there by the lead.
