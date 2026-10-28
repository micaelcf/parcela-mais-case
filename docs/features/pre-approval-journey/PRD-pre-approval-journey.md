# PRD — Parallel multi-lender pre-approval journey

> Written from the [RFC](./RFC-pre-approval-journey.md), which is written from the [grill decisions](./grill-decisions-2026-10-27-pre-approval-journey.md). Where they disagree, grill-decisions wins, then the RFC.
> **This document is the requirement identifier registry.** Ids are permanent and never renumbered. A cut requirement is struck through and kept.
> Every requirement belongs to the single target repo `parcela-mais-case`.
> **Status (2026-10-28):** implemented and audited (Stage 5 PASS). What shipped is in [API_HANDOFF.md](./API_HANDOFF.md), which supersedes this PRD wherever they disagree. Amended rows say so inline.

## Summary

A clinic enters a patient's data once. The system queries four (simulated) lenders in parallel, shows each lender's status live, and presents offers with Tabela Price installments within a 10-second deadline, even when lenders are slow, fail or refuse. The patient chooses an offer, and the choice is persisted. A protected backoffice tracks the money pipeline, lender health, consultations and abuse. It's built as a real implementation: real tests, real endpoints, real deployment.

## Contacts

| Role                           | Who    |
| ------------------------------ | ------ |
| Driver                         | Micael |
| Approver                       | Micael |
| Engineer (`parcela-mais-case`) | Micael |
| Channel                        | none   |

## Background

See [RFC § Background](./RFC-pre-approval-journey.md#background). In short, the technical case PDF defines a three-step journey (signup, pre-approval, offers) against four fictional lenders whose behaviour guarantees that, in most consultations, at least one thing goes wrong. The owner chose to build it as production software rather than an exercise. No baseline exists: there are no users and no traffic.

## Objective & success metrics

**Objective.** Give the clinic a useful credit answer within 10 seconds, regardless of how many lenders misbehave, and make every money-related outcome traceable.

| Metric                                 | Current         | Target                                                                                                             | How measured                                                                       |
| -------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Forced scenarios demonstrate correctly | n/a (not built) | Each of `ALL_APPROVE`, `DELTA_FAILS`, `DELTA_TIMES_OUT`, `NONE_APPROVE` produces its expected screen in 20/20 runs | Run each scenario 20× under `vp run up --prod` and check the terminal screen state |
| Journey always closes by the deadline  | n/a             | 100 % of consultations terminal within 10 s + 1 s grace                                                            | Consultation terminal timestamp − `created_at`                                     |
| One-command run from a clean clone     | n/a             | `vp run up --prod` brings up a healthy stack on Podman **and** on Docker                                           | Fresh clone on each engine; health endpoint returns OK                             |
| Critical-path tests green              | n/a             | CPF validation, Price calculation and orchestration (timeout, failure, race) suites pass                           | `vp test`                                                                          |
| Full test pyramid working              | n/a             | Unit, integration (real Postgres) and E2E suites all pass; E2E authored in the final phase                         | `vp test` + the E2E runner (RFC O4)                                                |

## Segments

- **Clinic operator.** Has the patient in front of them, fills in the form, and needs an answer fast, in pt-BR.
- **Patient.** The credit applicant. Compares offers and chooses one. Their CPF and personal data must not leak.
- **Backoffice operator.** A single, authenticated role that monitors volume, lender health and abuse, and can disable a lender.

Constraints: Brazil (CPF, BRL, pt-BR copy), LGPD-minded handling of PII. Lenders and rates are fictional (PDF p.1).

## Value proposition

- **Speed despite failures.** The first offer is choosable the moment it arrives; nobody waits for the slowest lender.
- **Honesty under failure.** Every lender ends visibly approved, refused or unavailable, never stuck.
- **A useful dead end.** When nobody approves, the screen says why (non-sensitively) and offers a concrete smaller amount.
- **Traceability.** Every offer and choice is an immutable record; the backoffice explains every consultation.

## Solution overview

**Flow.** Multi-step signup → submit → consultation page `/consultas/<id>` with four lender cards updating live → offers per approving lender (installment and total per term, sortable) → choose → confirmation. Alternative ending: no approvals → reason + "try R$ X" → a new consultation.

**Key capabilities.**

- Multi-step validated signup that keeps values across steps (RF-1xx).
- Parallel pre-approval with a hard 10 s deadline and live status (RF-2xx).
- Lender simulator with forced scenarios, circuit breaker and kill switch (RF-2xx).
- No-approval explanation and requote (RF-3xx).
- Offers with Price installments, sorting and persisted choice (RF-4xx).
- Privacy and abuse controls (RF-5xx).
- Protected backoffice with dashboards and server-first tables (RF-6xx).
- Operations commands `doctor`, `up`, `prune`, `deploy` (RF-7xx).
- Quality: test pyramid, accessibility, per-lender logs (RF-8xx).

**Assumptions** (full table with triggers in [RFC § Assumptions](./RFC-pre-approval-journey.md#assumptions)):

| Kind        | Assumption                                                                 | Status                                 |
| ----------- | -------------------------------------------------------------------------- | -------------------------------------- |
| Value       | Choosing an offer early beats waiting for a full comparison (RFC A24)      | Accepted risk                          |
| Value       | A pipeline/lender-health dashboard covers the financial-tracking need (A1) | Validated by the owner                 |
| Usability   | Losing a half-typed form on reload is rare enough (A14)                    | Accepted risk                          |
| Viability   | Losing ~30 % of Delta's answers without retry is acceptable (A10)          | Accepted risk                          |
| Feasibility | Queue pickup and SSE stay fast enough for live cards (A8, A9)              | To validate in Stage 3–4               |
| Feasibility | The TypeBox form adapter shows errors on the right field (A23)             | Path mapping validated; UI to validate |

## Requirements

Single release (see Release & phasing). All requirements are **P0**.

### Signup — RF-1xx

| id     | Requirement                                                                                                                     | Acceptance criteria                                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-101 | Signup collects full name, CPF, birthdate, address, mobile phone, monthly income and treatment amount across more than one step | All seven are present (address per RF-111); submit is only reachable from the last step. _Amended 2026-10-28: address added (RFC D27)_                                             |
| RF-102 | The form rejects a CPF with invalid check digits before submit                                                                  | Entering `529.982.247-24` shows a pt-BR error on the CPF field (not the form root); submit is blocked                                                                              |
| RF-103 | The API rejects a CPF with invalid check digits                                                                                 | `POST /api/consultations` with an invalid CPF → 422 with an error at the CPF field path; no consultation row is created                                                            |
| RF-104 | The form and API reject applicants younger than 18 or older than 80                                                             | Birthdate giving age 17 or 81 → field error in the form; 422 from the API                                                                                                          |
| RF-105 | The form and API reject treatment amounts outside R$ 1.000,00 – R$ 50.000,00                                                    | R$ 999,99 and R$ 50.000,01 → field error in the form; 422 from the API; R$ 1.000,00 and R$ 50.000,00 accepted                                                                      |
| RF-106 | Moving back a step keeps every value already entered                                                                            | Fill steps 1–2, go back to step 1, then forward: all values intact                                                                                                                 |
| RF-107 | No signup data is written to browser storage                                                                                    | After filling and reloading before submit, `localStorage` and `sessionStorage` hold no form data, and the form is empty                                                            |
| RF-108 | Replaying a submission with the same `Idempotency-Key` and body returns the original consultation                               | Two identical POSTs with one key → the same consultation id; exactly one consultation and one fan-out exist                                                                        |
| RF-109 | Reusing an `Idempotency-Key` with a different body is rejected                                                                  | Same key, different body → 422; no new consultation                                                                                                                                |
| RF-110 | Resubmitting a known CPF reuses the same patient record                                                                         | Two consultations with the same CPF → one patient; each consultation keeps its own frozen income and amount                                                                        |
| RF-111 | Step 1 collects the patient's address after the birthdate, starting with the CEP                                                | CEP (`00000-000`) first; street, number, complement (optional), neighborhood, city and UF follow. _Added 2026-10-28 (RFC D27)_                                                     |
| RF-112 | A valid CEP fills the address automatically, and the address fields appear only after the CEP resolves                          | Before the lookup only the CEP shows; a known CEP reveals the fields prefilled (city/UF read-only) with focus on the number; a new CEP refills them                                |
| RF-113 | An unknown CEP is reported on the CEP field                                                                                     | `CEP não encontrado` under the CEP; the address fields stay hidden; `Próximo` is blocked                                                                                           |
| RF-114 | When the CEP service is unavailable, the address can be typed manually                                                          | Lookup 503 → a hint and empty, editable fields (UF as a select); the signup can still be submitted                                                                                 |
| RF-115 | The API validates and stores the address, and never exposes it publicly                                                         | Missing/invalid parts → 422 at `address.*`; stored normalised on the patient; absent from public GET/SSE/choose/requote payloads                                                   |
| RF-116 | CEP lookups are capped per client IP                                                                                            | Lookups past `RATE_LIMIT_LOOKUP_IP_MAX` in the window → 429 `IP_LIMIT`, counted separately from create/requote                                                                     |
| RF-117 | Step 2 collects an optional patient e-mail                                                                                      | Blank → accepted, stored as none; a valid address → stored trimmed and lower-cased; `ana@exemplo` → field error on blur, 422 at `email` from the API. _Added 2026-10-28 (RFC D30)_ |
| RF-118 | Signup fields are validated on blur and on submit, never while typing                                                           | Typing a partial CPF shows no error until the field loses focus; `Próximo` shows every error of its step                                                                           |
| RF-119 | The stepper makes the current step obvious                                                                                      | Each step has a semantic icon; the active step is highlighted and carries `aria-current="step"`; completed steps show a check and can be revisited                                 |

### Pre-approval — RF-2xx

| id     | Requirement                                                                                                                           | Acceptance criteria                                                                                                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-201 | Submitting returns the consultation id before any lender answers                                                                      | `POST /api/consultations` responds 202 with the id while all four attempts are still `PENDING`                                                                                                                                                                          |
| RF-202 | All four lenders are queried in parallel for each consultation                                                                        | Every consultation has exactly four attempts (Alfa, Beta, Gama, Delta), and their call start times are within the queue pickup window of one another                                                                                                                    |
| RF-203 | The consultation page shows each lender's status as consultando, aprovada, recusada or indisponível                                   | Four cards are visible, each in exactly one of the four pt-BR states                                                                                                                                                                                                    |
| RF-204 | Each lender card updates as its answer arrives, without a page reload                                                                 | In `NORMAL` mode, Alfa's card changes state before Delta's, with no navigation                                                                                                                                                                                          |
| RF-205 | Every consultation reaches a terminal state within the 10 s deadline                                                                  | Terminal time − `created_at` ≤ 10 s + 1 s grace; lenders not answered by then show "indisponível" with reason `TIMEOUT`                                                                                                                                                 |
| RF-206 | A lender's HTTP 500 marks only that lender unavailable                                                                                | Delta 500 → Delta `UNAVAILABLE(LENDER_ERROR)`; other lenders unaffected; Delta called exactly once                                                                                                                                                                      |
| RF-207 | Reloading `/consultas/<id>` restores the current state                                                                                | Reload mid-consultation → the same card states, and live updates continue                                                                                                                                                                                               |
| RF-208 | A dropped live connection recovers the full current state                                                                             | After a forced disconnect, the reconnected stream's first message is a complete snapshot matching the DB                                                                                                                                                                |
| RF-209 | Each lender attempt settles exactly once                                                                                              | A worker result arriving after the deadline finalizer doesn't change the attempt's terminal status                                                                                                                                                                      |
| RF-210 | Alfa approves 100 % when income × 10 ≥ amount and refuses otherwise, responding in 0.5–1.5 s                                          | Boundary cases (equal and one cent above) produce approve/refuse; latency within range                                                                                                                                                                                  |
| RF-211 | Beta always approves at most 60 % of the amount, responding in 2–5 s                                                                  | Approved amount = 60 % of the request (rounded to the cent); latency within range                                                                                                                                                                                       |
| RF-212 | Gama refuses patients under 25 or amounts above R$ 20.000 and otherwise approves 100 %, responding in 1–3 s                           | Age 24 → refuse; R$ 20.000,01 → refuse; age 25 with R$ 20.000,00 → approve                                                                                                                                                                                              |
| RF-213 | Delta returns HTTP 500 on ~30 % of calls and otherwise approves 100 %, responding in 4–15 s                                           | Over 200 `NORMAL` calls, the 500 share is 30 % ± 7 pp; latency within range                                                                                                                                                                                             |
| RF-214 | With simulation controls on, the form offers a scenario picker for `ALL_APPROVE`, `DELTA_FAILS`, `DELTA_TIMES_OUT` and `NONE_APPROVE` | Each scenario produces its outcome 20/20 times                                                                                                                                                                                                                          |
| RF-215 | With simulation controls off, forced scenarios are unavailable                                                                        | The picker isn't rendered; a POST with a non-`NORMAL` scenario → 422                                                                                                                                                                                                    |
| RF-216 | A lender with an open circuit is skipped without a call                                                                               | After ≥ 16 failures in the last 20 `NORMAL` attempts within 5 min, the next `NORMAL` attempt settles `UNAVAILABLE(CIRCUIT_OPEN)` with no outbound call. _Amended 2026-10-28 (verification): forced-scenario attempts bypass the breaker and are still called (RFC D11)_ |
| RF-217 | An open circuit allows one probe call after 30 s                                                                                      | 30 s after opening, exactly one attempt calls the lender                                                                                                                                                                                                                |
| RF-218 | Forced-scenario attempts never affect the circuit breaker                                                                             | 20 `DELTA_FAILS` consultations followed by a `NORMAL` one → Delta is called                                                                                                                                                                                             |
| RF-219 | A lender disabled by the kill switch is skipped without a call                                                                        | Disabled lender → attempt `UNAVAILABLE(DISABLED)` with no outbound call, even if its breaker is closed                                                                                                                                                                  |

### No approval — RF-3xx

| id     | Requirement                                                                                          | Acceptance criteria                                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| RF-301 | When no lender approves, the screen explains each lender's outcome in non-sensitive terms            | Each lender shows one of: amount above limit, profile not eligible, unavailable; no rule internals (income × 10, age, R$ 20k) appear |
| RF-302 | When no lender approves, the screen suggests the highest amount any lender hinted it could approve   | `NONE_APPROVE` with an Alfa hint → the suggestion equals Alfa's hinted amount                                                        |
| RF-303 | Requote creates a new consultation for the same patient with a lower amount                          | `POST /api/consultations/:id/requote` → a new consultation id whose frozen inputs equal the source's except the amount               |
| RF-304 | Requote is refused when the source is not terminal, has an approval, or the amount is not lower      | Each case → 4xx response; no consultation and no lender job is created                                                               |
| RF-305 | Replaying a requote with the same `Idempotency-Key` returns the original new consultation            | Double submit → one new consultation                                                                                                 |
| RF-306 | A requote runs in `NORMAL` scenario unless a scenario is explicitly sent with simulation controls on | Requote of a `NONE_APPROVE` consultation without a scenario → the new consultation's scenario is `NORMAL`                            |

### Offers & choice — RF-4xx

| id     | Requirement                                                                                       | Acceptance criteria                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-401 | Each approving lender's offer shows the approved amount, the monthly rate and the available terms | The Alfa card shows rate 2,49 % a.m. and terms 6, 12, 18 (and likewise per the PDF lender table)                                             |
| RF-402 | Each term shows the Tabela Price installment and the total paid                                   | For PV = R$ 10.000,00, i = 2,49 %, n = 12: installment and total match the PMT formula, rounded half-up to the cent, total = installment × n |
| RF-403 | An offer whose approved amount is below the requested amount is visibly flagged                   | A Beta offer (60 %) shows a "valor aprovado menor que o solicitado" indication                                                               |
| RF-404 | Offers can be sorted by lowest installment                                                        | Sorting puts the lowest installment first                                                                                                    |
| RF-405 | Offers can be sorted by lowest total cost                                                         | Sorting puts the lowest total first                                                                                                          |
| RF-406 | Choosing an offer persists the choice and shows a confirmation                                    | After choosing, a reload of the consultation page still shows the confirmation for that offer                                                |
| RF-407 | An offer can be chosen while other lenders are still consulting                                   | With Delta pending, choosing an Alfa offer succeeds and shows the confirmation                                                               |
| RF-408 | Re-choosing the same offer returns the same result                                                | Second identical choose → 200 with an identical body                                                                                         |
| RF-409 | Choosing a different offer after a choice is rejected                                             | → 409; the stored choice is unchanged                                                                                                        |
| RF-410 | Lender answers arriving after a choice are recorded without changing the choice                   | `DELTA_TIMES_OUT`: after the deadline, Delta's attempt is recorded and the choice is unchanged                                               |

### Privacy & abuse — RF-5xx

| id     | Requirement                                                         | Acceptance criteria                                                                                                       |
| ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| RF-501 | Public consultation responses contain no CPF digits                 | Public GET/SSE/choose/requote payloads contain no 3+ consecutive digits of the patient's CPF and no mask                  |
| RF-502 | Public consultation responses contain no birthdate, phone or income | Payloads checked for each value; none present; the first name is the only identity field                                  |
| RF-503 | The CPF is never stored in plaintext                                | No column of any table contains the 11 CPF digits after a submission                                                      |
| RF-504 | A patient exceeding the consultation cap is refused                 | With cap N (O2), consultation N+1 for one CPF within the window → 429 with a pt-BR message; applies to create and requote |
| RF-505 | A client IP exceeding the request cap is refused                    | Requests beyond the per-IP cap (O2) on the create/requote routes → 429; invalid requests count toward the cap             |
| RF-506 | A client-supplied forwarding header cannot change the counted IP    | A request through the proxy with a forged `X-Forwarded-For` is counted against the real peer address                      |

### Backoffice — RF-6xx

| id     | Requirement                                                                                                                                         | Acceptance criteria                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| RF-601 | The operator can log in with the configured username and password                                                                                   | Correct credentials → access to `/backoffice`; wrong password → error, no session                                           |
| RF-602 | Backoffice API calls without a valid session are refused                                                                                            | Missing, tampered or expired session → 401 on every `/api/backoffice/*` route                                               |
| RF-603 | The operator can log out                                                                                                                            | After logout, `/api/backoffice/*` → 401                                                                                     |
| RF-604 | The money pipeline view shows requested, approved and chosen volume over time                                                                       | Values equal sums computed from consultations, offers and choices for the selected period                                   |
| RF-605 | The money pipeline view shows approval rate, approved/requested ratio, chosen volume per lender, and average installment and total of chosen offers | Each figure matches a direct aggregate over the same period                                                                 |
| RF-606 | The lender health view shows p50/p95 latency and approval/refusal/error/timeout rates per lender                                                    | Figures match aggregates over settled attempts                                                                              |
| RF-607 | The lender health view shows each lender's circuit state and kill-switch state                                                                      | An open circuit (RF-216) is displayed as open                                                                               |
| RF-608 | The operator can disable and re-enable a lender                                                                                                     | Toggling changes the RF-219 behaviour for new attempts                                                                      |
| RF-609 | Every kill-switch change is logged with actor and time                                                                                              | The log lists each change with username and timestamp; entries can't be edited                                              |
| RF-610 | The lender health view shows queue backlog per lender                                                                                               | The backlog count matches pending jobs per lender queue                                                                     |
| RF-611 | The consultation explorer lists consultations                                                                                                       | Paginated list of consultations with status, amount, scenario and created time                                              |
| RF-612 | The consultation detail shows the full patient data, including the decrypted CPF                                                                    | The detail shows name, CPF, birthdate, phone, income, frozen inputs, attempt timeline with reasons, offers and the choice   |
| RF-613 | The operator can find a patient's consultations by exact CPF                                                                                        | Exact CPF → matching consultations; partial CPF → no partial matching; the CPF never appears in the URL                     |
| RF-614 | The abuse view shows limit hits, 429 counts and the top CPFs/IPs by volume in the last 24 h                                                         | Figures match the throttle and consultation records                                                                         |
| RF-615 | Every backoffice table pages, sorts, filters and searches on the server                                                                             | Changing page, sort, filter or search issues an API request; the response is `{ items, page, pageSize, total, totalPages }` |
| RF-616 | Unknown sort or filter fields are rejected                                                                                                          | A list request with a non-allow-listed field → 422                                                                          |
| RF-617 | Table state is kept in the URL, except the CPF                                                                                                      | Reloading a table URL restores page, sort, filters and search; no CPF value appears in any URL                              |

### Operations — RF-7xx

| id     | Requirement                                                               | Acceptance criteria                                                                                                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-701 | `vp run up` starts the dev environment                                    | Postgres container up, migrations applied, dev server with HMR and worker in watch mode running                                                                                                                                                                 |
| RF-702 | `vp run up --prod` starts the production-parity stack                     | Proxy, app, worker and Postgres containers healthy; the URL is printed                                                                                                                                                                                          |
| RF-703 | The stack runs on both Podman and Docker                                  | RF-702 passes with `podman compose` and with `docker compose`                                                                                                                                                                                                   |
| RF-704 | `vp run doctor` reports environment readiness without changing anything   | Lists engine/compose, Bun version, env validity, DB reachability, pending migrations, ports and the rootless port floor; no files, containers or data change                                                                                                    |
| RF-705 | `vp run prune` resets the local environment                               | Project containers, local DB volume, images and build cache removed; it has no option to target another host. _Amended 2026-10-28 (verification): on Docker the build-cache step is skipped and reported, since BuildKit's cache isn't project-scoped (RFC D5)_ |
| RF-706 | `vp run deploy` refuses a dirty working tree                              | Uncommitted changes → exits non-zero before building                                                                                                                                                                                                            |
| RF-707 | A failed migration stops a deploy before the app starts                   | A migration error → the app and worker don't start; non-zero exit                                                                                                                                                                                               |
| RF-708 | The health endpoint reports the deployed commit                           | `/api/health` returns the SHA equal to `git rev-parse HEAD` at deploy time                                                                                                                                                                                      |
| RF-709 | A healthy deploy removes this project's superseded images and build cache | After a successful deploy, only the current image of each service remains. _Amended 2026-10-28 (verification): build cache pruned on Podman only (RFC D5)_                                                                                                      |
| RF-710 | No ops script opens a connection to another host                          | None of `doctor`, `up`, `down`, `prune`, `deploy` invokes SSH or any remote session, or fetches from git                                                                                                                                                        |
| RF-711 | `vp run down` stops the local stack without losing data                   | Removes (or with `--stop` only stops) this project's containers and network, dev and prod-parity; the database volume and images stay; any other option is refused before anything runs. _Added 2026-10-28 (user request)_                                      |

### Quality — RF-8xx

| id     | Requirement                                                       | Acceptance criteria                                                                                                |
| ------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| RF-801 | CPF validation has automated tests                                | Valid, invalid check digit, repeated digits, formatted and unformatted input covered; `vp test` passes             |
| RF-802 | Price calculation has automated tests                             | PMT per the PDF formula, rounding to the cent, total = installment × n, for every lender rate/term; passes         |
| RF-803 | Orchestration has automated tests for the deadline                | A lender that never answers → `UNAVAILABLE(TIMEOUT)` and terminal ≤ 10 s, on real Postgres                         |
| RF-804 | Orchestration has automated tests for lender failures             | A lender 500 → `UNAVAILABLE(LENDER_ERROR)`, others unaffected, on real Postgres                                    |
| RF-805 | Orchestration has automated tests for races                       | Finalizer vs late worker, and concurrent double choose, each yield exactly one outcome, on real Postgres           |
| RF-806 | Integration tests create data only through application code       | No integration test imports the DB client or a table object for setup                                              |
| RF-807 | End-to-end tests cover the critical paths                         | E2E (final phase) covers signup → offers → choice, each forced scenario, and no approval → requote; all pass       |
| RF-808 | Critical paths are smoke-tested in a real browser before delivery | Signup, live cards, choice, requote and backoffice login exercised in a browser; observed results recorded         |
| RF-809 | The journey is operable by keyboard                               | Every journey step is completable without a mouse; visible focus throughout                                        |
| RF-810 | Lender status changes are announced to screen readers             | Each card state change is announced via an `aria-live` region                                                      |
| RF-811 | Each lender call emits one structured log line without PII        | One JSON line per call with lender, attempt id, latency, outcome and reason; no CPF, name, phone or income in logs |

## Non-goals

- **Journey stages 4–7**: proposal submission, async analysis, signing, disbursement (RFC D1). Reopens if any money-moving event is required.
- **A double-entry ledger** (D1): nothing in scope moves money.
- **Retries of lender calls** (D10).
- **Pre-submit draft persistence** in the browser or the server (D14).
- **Offer expiry** (AD17).
- **Multiple backoffice users, roles or session revocation** (D12).
- **Public display of any CPF digits** (D13).
- **SSR of any frontend route** (D25).
- **Keyset pagination** (D26).
- **Remote-executing ops commands** (D6).
- **Real lender integrations**: the lenders are simulated (D19).
- **Case-submission deliverables** (README sections addressed to evaluators, AI-usage notes): deferred by the owner to the audit phase.

## Release & phasing

**Single release; every requirement is P0** (owner decision, 2026-10-27). Within that release, the build order ends with **E2E tests (RF-807) and browser smoke tests (RF-808)**, written once everything else is done. Milestones are outcomes:

1. The journey works end to end under `vp run up` with all four forced scenarios.
2. Backoffice, abuse controls and operations commands work under `vp run up --prod` on Podman and Docker.
3. The E2E suite passes and the browser smoke on critical paths is recorded.

## Open questions

| Question                                                                                                           | Owner  | Needed by                            |
| ------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------ |
| Rate-limit thresholds for RF-504/RF-505 (provisional 5 / patient / 24 h; 30 / IP / hour) (RFC O2)                  | Micael | Before RF-504/RF-505 are accepted    |
| ~~E2E runner for RF-807 (RFC O4)~~ **Closed (2026-10-28, implementation):** Playwright Test standalone, see RFC O4 | Micael | Before the E2E phase                 |
| Public hostname/TLS for the deployed stack (RFC O1)                                                                | Micael | Before the first VPS deploy with TLS |
| VPS OS and Podman mode (RFC O3)                                                                                    | Micael | Before the first VPS deploy          |
