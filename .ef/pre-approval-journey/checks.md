# Pre-approval journey — parcela-mais-case

Sources:

- [grill-decisions](../../docs/features/pre-approval-journey/grill-decisions-2026-10-27-pre-approval-journey.md): rationale source of truth; wins on conflict
- [RFC](../../docs/features/pre-approval-journey/RFC-pre-approval-journey.md): decisions D1–D26, AD1–AD20, with Stage 3 amendments
- [PRD](../../docs/features/pre-approval-journey/PRD-pre-approval-journey.md): requirement registry RF-101…RF-811
- [knowledge/stack-baseline.md](../../knowledge/stack-baseline.md): verified template/toolchain facts
- `contract/` (this folder): **binding for every interface**
- Case PDF `C:\Users\Micael\Downloads\Case Técnico · Dev Full Stack Sênior.pdf`: lender table, Price formula, validation bounds

Feature base: none (repository has no commits yet, 2026-10-27).

## Requirements

- `RF-101` — Signup collects full name, CPF, birthdate, mobile phone, monthly income and treatment amount across more than one step
- `RF-102` — The form rejects a CPF with invalid check digits before submit
- `RF-103` — The API rejects a CPF with invalid check digits
- `RF-104` — The form and API reject applicants younger than 18 or older than 80
- `RF-105` — The form and API reject treatment amounts outside R$ 1.000,00 – R$ 50.000,00
- `RF-106` — Moving back a step keeps every value already entered
- `RF-107` — No signup data is written to browser storage
- `RF-108` — Replaying a submission with the same `Idempotency-Key` and body returns the original consultation
- `RF-109` — Reusing an `Idempotency-Key` with a different body is rejected
- `RF-110` — Resubmitting a known CPF reuses the same patient record
- `RF-201` — Submitting returns the consultation id before any lender answers
- `RF-202` — All four lenders are queried in parallel for each consultation
- `RF-203` — The consultation page shows each lender's status as consultando, aprovada, recusada or indisponível
- `RF-204` — Each lender card updates as its answer arrives, without a page reload
- `RF-205` — Every consultation reaches a terminal state within the 10 s deadline
- `RF-206` — A lender's HTTP 500 marks only that lender unavailable
- `RF-207` — Reloading `/consultas/<id>` restores the current state
- `RF-208` — A dropped live connection recovers the full current state
- `RF-209` — Each lender attempt settles exactly once
- `RF-210` — Alfa approves 100 % when income × 10 ≥ amount and refuses otherwise, responding in 0.5–1.5 s
- `RF-211` — Beta always approves at most 60 % of the amount, responding in 2–5 s
- `RF-212` — Gama refuses patients under 25 or amounts above R$ 20.000 and otherwise approves 100 %, responding in 1–3 s
- `RF-213` — Delta returns HTTP 500 on ~30 % of calls and otherwise approves 100 %, responding in 4–15 s
- `RF-214` — With simulation controls on, the form offers a scenario picker for the four forced scenarios
- `RF-215` — With simulation controls off, forced scenarios are unavailable
- `RF-216` — A lender with an open circuit is skipped without a call
- `RF-217` — An open circuit allows one probe call after 30 s
- `RF-218` — Forced-scenario attempts never affect the circuit breaker
- `RF-219` — A lender disabled by the kill switch is skipped without a call
- `RF-301` — When no lender approves, the screen explains each lender's outcome in non-sensitive terms
- `RF-302` — When no lender approves, the screen suggests the highest amount any lender hinted it could approve
- `RF-303` — Requote creates a new consultation for the same patient with a lower amount
- `RF-304` — Requote is refused when the source is not terminal, has an approval, or the amount is not lower
- `RF-305` — Replaying a requote with the same `Idempotency-Key` returns the original new consultation
- `RF-306` — A requote runs in `NORMAL` scenario unless a scenario is explicitly sent with simulation controls on
- `RF-401` — Each approving lender's offer shows the approved amount, the monthly rate and the available terms
- `RF-402` — Each term shows the Tabela Price installment and the total paid
- `RF-403` — An offer whose approved amount is below the requested amount is visibly flagged
- `RF-404` — Offers can be sorted by lowest installment
- `RF-405` — Offers can be sorted by lowest total cost
- `RF-406` — Choosing an offer persists the choice and shows a confirmation
- `RF-407` — An offer can be chosen while other lenders are still consulting
- `RF-408` — Re-choosing the same offer returns the same result
- `RF-409` — Choosing a different offer after a choice is rejected
- `RF-410` — Lender answers arriving after a choice are recorded without changing the choice
- `RF-501` — Public consultation responses contain no CPF digits
- `RF-502` — Public consultation responses contain no birthdate, phone or income
- `RF-503` — The CPF is never stored in plaintext
- `RF-504` — A patient exceeding the consultation cap is refused
- `RF-505` — A client IP exceeding the request cap is refused
- `RF-506` — A client-supplied forwarding header cannot change the counted IP
- `RF-601` — The operator can log in with the configured username and password
- `RF-602` — Backoffice API calls without a valid session are refused
- `RF-603` — The operator can log out
- `RF-604` — The money pipeline view shows requested, approved and chosen volume over time
- `RF-605` — The money pipeline view shows approval rate, approved/requested ratio, chosen volume per lender, and average installment and total of chosen offers
- `RF-606` — The lender health view shows p50/p95 latency and approval/refusal/error/timeout rates per lender
- `RF-607` — The lender health view shows each lender's circuit state and kill-switch state
- `RF-608` — The operator can disable and re-enable a lender
- `RF-609` — Every kill-switch change is logged with actor and time
- `RF-610` — The lender health view shows queue backlog per lender
- `RF-611` — The consultation explorer lists consultations
- `RF-612` — The consultation detail shows the full patient data, including the decrypted CPF
- `RF-613` — The operator can find a patient's consultations by exact CPF
- `RF-614` — The abuse view shows limit hits, 429 counts and the top CPFs/IPs by volume in the last 24 h
- `RF-615` — Every backoffice table pages, sorts, filters and searches on the server
- `RF-616` — Unknown sort or filter fields are rejected
- `RF-617` — Table state is kept in the URL, except the CPF
- `RF-701` — `vp run up` starts the dev environment
- `RF-702` — `vp run up --prod` starts the production-parity stack
- `RF-703` — The stack runs on both Podman and Docker
- `RF-704` — `vp run doctor` reports environment readiness without changing anything
- `RF-705` — `vp run prune` resets the local environment
- `RF-706` — `vp run deploy` refuses a dirty working tree
- `RF-707` — A failed migration stops a deploy before the app starts
- `RF-708` — The health endpoint reports the deployed commit
- `RF-709` — A healthy deploy removes this project's superseded images and build cache
- `RF-710` — No ops script opens a connection to another host
- `RF-801` — CPF validation has automated tests
- `RF-802` — Price calculation has automated tests
- `RF-803` — Orchestration has automated tests for the deadline
- `RF-804` — Orchestration has automated tests for lender failures
- `RF-805` — Orchestration has automated tests for races
- `RF-806` — Integration tests create data only through application code
- `RF-807` — End-to-end tests cover the critical paths
- `RF-808` — Critical paths are smoke-tested in a real browser before delivery
- `RF-809` — The journey is operable by keyboard
- `RF-810` — Lender status changes are announced to screen readers
- `RF-811` — Each lender call emits one structured log line without PII

## Contract

| File                                               | Holds                                                                                             | Read by                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------- |
| [contract/bindings.md](contract/bindings.md)       | gates, version pins, runtime rules, aliases, test conventions, env vars                           | every slice               |
| [contract/layout.md](contract/layout.md)           | directory tree, file roles, shared names, dependency directions                                   | every slice               |
| [contract/schema.md](contract/schema.md)           | enums, tables, indexes, relations-part rules                                                      | data + backend slices     |
| [contract/api.md](contract/api.md)                 | endpoints, view shapes, list contract, errors, simulator HTTP contracts                           | backend + frontend slices |
| [contract/boundaries.md](contract/boundaries.md)   | transactions, guarded updates, orchestration order, breaker, Price, scenarios, throttle, realtime | backend slices            |
| [contract/lender-port.md](contract/lender-port.md) | LenderPort, canonical result, mapping rules, lender catalogue                                     | lender + simulator slices |
| [contract/ops.md](contract/ops.md)                 | compose, Dockerfile, Caddyfile, ops scripts, worker process                                       | ops slice                 |
| [contract/frontend.md](contract/frontend.md)       | no-SSR shell, routes, data access, forms, UI kit, a11y                                            | frontend slices           |

## Out of scope

- Journey stages 4–7 and any ledger: RFC D1.
- Lender retries: D10. Offer expiry: AD17. Multi-user backoffice: D12. Keyset pagination: D26.
- Real lender integrations: D19 (simulated).
- Case-submission README sections: deferred to the audit phase (PRD non-goals).

## Landing

Greenfield feature on a template: the module tree in `contract/layout.md` is the precedent every future feature copies, so it's a door.

| One-way door                 | Literal shape                                                                                                            | Alternative rejected                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Persisted schema             | 7 tables + 5 enums in `contract/schema.md`; cents as `bigint(number)`; uuid v7 from JS                                   | `bigint(mode:"bigint")`: Elysia 2 RC can't serialise it (500/422, probed)                   |
| Module layout pattern        | `src/server/modules/<feature>/{db/*.table.ts, *.relations.ts, *.repository.ts, *.service.ts, *.routes.ts, *.schemas.ts}` | flat `src/db/schema.ts`: can't say which feature owns a table                               |
| Queue + transactional outbox | pg-boss 12.38 own pool (max 3) + `send({ db: fromDrizzle(tx, sql) })`                                                    | shared pool + hand-written `listen()`: we'd own LISTEN reconnect (user chose, discovery Q2) |
| Realtime                     | one LISTEN client per app process + in-memory fan-out; SSE `sse()` envelopes; client-owned reconnect                     | LISTEN per SSE stream: one pinned connection per open tab                                   |
| Validation stack             | TypeBox everywhere + `shared/schema/standard-schema.ts` adapter + pt-BR locale                                           | zod: user chose TypeBox (D23)                                                               |
| New dependencies             | elysia, @elysia/eden, typebox, pg-boss, drizzle 1.0 RC, @base-ui/react, shadcn deps, recharts, sonner                    | none forced                                                                                 |

## Slices

Defined at Stage 4 (`/ef:implement`).
