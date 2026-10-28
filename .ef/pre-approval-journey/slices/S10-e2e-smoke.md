# S10 — the critical paths pass end to end and in a real browser before delivery · ~12 files · est. ~10k

Wave 6 (final phase). Builder: lead, or one agent briefed with this file. Owns: `playwright.config.ts`, `test/e2e/**`, `package.json` (`e2e` script + `@playwright/test` dev dependency, this wave)
Reads: contract/bindings.md, contract/layout.md, contract/api.md, contract/frontend.md

Writes every E2E spec named by C122–C144 (S8) and C146–C154 (S9), asserting what those checks say. Specs run against `vp run up` (`SIMULATION_CONTROLS=true`) at `E2E_BASE_URL`; C155 runs against `vp run up --prod`. A spec never writes to the DB directly; it drives the UI or the public API.

**C155** · RF-506 — through Caddy (`up --prod`), `RATE_LIMIT_IP_MAX + 1` create requests each carrying a different forged `X-Forwarded-For` → the last one is 429 `IP_LIMIT`
Proof: `E2E_BASE_URL=http://localhost:8080 vp run e2e test/e2e/proxy.spec.ts -g "ignores a forged X-Forwarded-For"`

**C164** · RF-204 — through Caddy (`up --prod`), for `Accept-Encoding` Chromium's `zstd, br, gzip, deflate`, `gzip` and `identity` (3 members; the chosen `Content-Encoding` is recorded as an annotation), the first SSE snapshot arrives within 1.5 s and later snapshots more than 1 s after it (no proxy buffering) (added 2026-10-28, audit Q-2/QN2)
Proof: `E2E_BASE_URL=http://localhost:8080 vp run e2e test/e2e/proxy.spec.ts -g "streams snapshots through Caddy without buffering"`

**C156** · RF-807 — the E2E suite covers signup → offers → choice, each of the four forced scenarios, and no approval → requote, and passes
Proof: `vp run e2e`

**C157** · RF-808 — in a real browser against `vp run up`: signup, live cards, choice, requote and backoffice login are exercised, and the observed result of each is recorded
Proof: `log.md` § S10 "Browser smoke"
