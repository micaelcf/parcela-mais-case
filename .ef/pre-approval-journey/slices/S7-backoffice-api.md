# S7 — the operator authenticates and reads pipeline, lender health, consultations and abuse from server-first endpoints · ~12 files · est. ~16k

Wave 4. Owns: `src/server/modules/backoffice/**` except `auth/password.ts` and its test (S5), and the backoffice registration line in `src/server/app.ts`
Reads: contract/bindings.md, contract/layout.md, contract/schema.md, contract/api.md, contract/signatures.md

Non-goals: no UI; no multi-user, roles or session revocation (D12). Data comes from the public API plus the worker (`signatures.md` § S4), never from table writes. Integration tests live in `test/integration/backoffice/` (owned by this slice).

Metric definitions (over consultations created in `[from, to)`):

- requested = Σ `treatment_amount_cents`; approved = Σ per consultation of its highest `APPROVED` `approved_cents`; chosen = Σ the chosen offers' `approved_cents`; each bucketed by `date_trunc(bucket, created_at)`.
- approvalRate = consultations with ≥ 1 `APPROVED` attempt ÷ `SETTLED` consultations; approvedRequestedRatio = approved ÷ requested of those same consultations; chosenByLender = Σ chosen `approved_cents` per lender; avgChosenInstallmentCents / avgChosenTotalCents = rounded mean over chosen offers.
- per lender over attempts settled in the period: p50/p95 of `latency_ms` (called attempts, `percentile_cont`); approval/refusal/error/timeout rates = count of `APPROVED` / `REFUSED` / `UNAVAILABLE` with `LENDER_ERROR` or `INTEGRATION_ERROR` / `UNAVAILABLE` with `TIMEOUT`, each ÷ settled attempts.

**C101** · RF-601 — POST session with the configured credentials → 204 with `Set-Cookie: bo_session` (`HttpOnly`, `SameSite=Lax`, `Max-Age=28800`); GET session with it → 200 `{ username }`
Proof: `vp test test/integration/backoffice/backoffice.auth.int.test.ts -t "logs in with the configured credentials"`

**C102** · RF-601 — a wrong password → 401 `INVALID_CREDENTIALS` with no `Set-Cookie`
Proof: `vp test test/integration/backoffice/backoffice.auth.int.test.ts -t "refuses a wrong password without a session"`

**C103** · RF-602 — every `/api/backoffice/*` route except `POST /session` → 401 `UNAUTHENTICATED` with a missing, a tampered and an expired cookie (table over every route × 3 cases)
Proof: `vp test test/integration/backoffice/backoffice.auth.int.test.ts -t "refuses every route without a valid session"`

**C104** · RF-603 — DELETE session → 204 clearing the cookie (`Max-Age=0`); the next request from the same cookie jar → 401
Proof: `vp test test/integration/backoffice/backoffice.auth.int.test.ts -t "logs out"`

**C105** · RF-604 — pipeline `requested`, `approved` and `chosen` per bucket equal the sums from the consultations, offers and choices created in the test (known `ALL_APPROVE`/`NONE_APPROVE` inputs)
Proof: `vp test test/integration/backoffice/backoffice.metrics.int.test.ts -t "sums requested, approved and chosen volume per bucket"`

**C106** · RF-605 — `approvalRate`, `approvedRequestedRatio`, `chosenByLender`, `avgChosenInstallmentCents` and `avgChosenTotalCents` equal the values computed from the same known inputs
Proof: `vp test test/integration/backoffice/backoffice.metrics.int.test.ts -t "derives pipeline ratios and chosen averages"`

**C107** · RF-606 — per lender, p50/p95 latency and approval/refusal/error/timeout rates equal the values computed from the repository's settled attempts (scenarios mixed so each rate is non-zero for some lender)
Proof: `vp test test/integration/backoffice/backoffice.metrics.int.test.ts -t "reports lender latency percentiles and outcome rates"`

**C108** · RF-607 — after Delta's circuit opens (failure rate 1, 20 `NORMAL` consultations) the lenders metric shows Delta `breaker: "OPEN"`; after a disable it shows `enabled: false`
Proof: `vp test test/integration/backoffice/backoffice.lenders.int.test.ts -t "shows circuit and kill-switch state"`

**C109** · RF-608 — PUT `/backoffice/lenders/delta/switch` `{ enabled: false }` → the next Delta attempt is `DISABLED`; `{ enabled: true }` → the next one is called
Proof: `vp test test/integration/backoffice/backoffice.lenders.int.test.ts -t "toggles a lender through the API"`

**C110** · RF-609 — two switch changes appear in the switch log newest first with `actor` = the session username and `createdAt`; PUT, PATCH and DELETE on a log entry path → 404
Proof: `vp test test/integration/backoffice/backoffice.lenders.int.test.ts -t "logs every switch change append-only"`

**C111** · RF-610 — with no worker running, after 3 creates `queueBacklog` is 3 for each lender
Proof: `vp test test/integration/backoffice/backoffice.lenders.int.test.ts -t "reports queue backlog per lender"`

**C112** · RF-611 — the consultations list returns `{ items, page, pageSize, total, totalPages }` whose items carry id, status, amount, scenario and createdAt, and no CPF field
Proof: `vp test test/integration/backoffice/backoffice.lists.int.test.ts -t "lists consultations"`

**C113** · RF-612 — the detail returns the decrypted 11-digit CPF, full name, birthdate, phone, income, frozen inputs, attempts with timestamps and reasons, offers and the choice
Proof: `vp test test/integration/backoffice/backoffice.lists.int.test.ts -t "shows the full patient with decrypted CPF"`

**C114** · RF-613 — POST search-by-cpf with a formatted exact CPF → that patient's consultations only; a 9-digit partial → 422 `VALIDATION` (no prefix matching)
Proof: `vp test test/integration/backoffice/backoffice.lists.int.test.ts -t "finds consultations by exact CPF only"`

**C115** · RF-614 — abuse metrics over the last 24 h: limit hits per code (`IP_LIMIT`, `PATIENT_LIMIT`), the 429 count, top patients (id + first name, no CPF) and top IP hashes (8 hex chars) match the requests made in the test
Proof: `vp test test/integration/backoffice/backoffice.metrics.int.test.ts -t "summarises abuse in the last 24 h"`

**C116** · RF-615 — each list endpoint (consultations, CPF search, switch log, throttle events: 4 members; CPF search added 2026-10-28, audit A5) honours `page`/`pageSize`, `sort` asc and desc with an `id` tiebreaker, an allow-listed filter and `q`, computed in SQL
Proof: `vp test test/integration/backoffice/backoffice.lists.int.test.ts -t "pages, sorts, filters and searches on the server"`

**C117** · RF-616 — each of those 4 list endpoints → 422 `VALIDATION` for an unknown `sort` field and for an unknown filter param (8 members)
Proof: `vp test test/integration/backoffice/backoffice.lists.int.test.ts -t "rejects unknown sort and filter fields"`

**C159** · RF-601 — `bo_session` carries `Secure` when `APP_DOMAIN` is set and not when it's unset, also under `NODE_ENV=production` (added 2026-10-28, audit Q-3)
Proof: `vp test test/integration/backoffice/backoffice.auth.int.test.ts -t "marks the session cookie Secure exactly when Caddy terminates TLS"`
