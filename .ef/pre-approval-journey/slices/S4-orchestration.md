# S4 — a submission fans out to four lenders, settles by the deadline, streams live, and accepts one choice · ~30 files · est. ~25k

Wave 2. Owns: `src/server/modules/consultation/**`, `src/server/modules/patient/*.ts` (not `db/`), `src/server/modules/lender/{lender-attempt,lender-setting}.*`, `src/server/modules/lender/lender-attempt.job.ts`, `src/server/modules/pricing/{pricing.service,offer.repository}.ts`, `src/server/infra/realtime/**`, `src/server/infra/worker/**`, `src/server/worker.ts`, `src/server/worker.main.ts`, `src/server/app.ts` (registers system, simulator, consultation), `test/integration/setup/app-fetch.ts`, `test/integration/consultation/**` (except the S6 files below), `test/integration/lender/**`
Reads: contract/bindings.md, contract/layout.md, contract/schema.md, contract/api.md, contract/boundaries.md, contract/lender-port.md, contract/signatures.md

Non-goals: requote, per-patient cap, per-IP throttle and the privacy scans are S6 (leave `requote` unimplemented; don't stub its route). No UI. Export the names in `signatures.md` § S4. Every proof below except `consultation.dto.test.ts` (co-located unit test) is an integration test on real Postgres under `test/integration/`. Tests that need answers start `createWorker({ lenderRegistry: testLenderRegistry })`.

**C41** · RF-103 — POST with CPF `529.982.247-24` → 422 `VALIDATION` with `fields[0].path = "cpf"`, and no consultation exists for that `Idempotency-Key`
Proof: `vp test test/integration/consultation/consultation.create.int.test.ts -t "rejects an invalid CPF at the cpf path"`

**C42** · RF-104 — birthdates giving age 17 and 81 → 422 at `birthdate`; ages 18 and 80 → 202 (4 members)
Proof: `vp test test/integration/consultation/consultation.create.int.test.ts -t "enforces the 18–80 age bounds"`

**C43** · RF-105 — `treatmentAmountCents` 99 999 and 5 000 001 → 422 at `treatmentAmountCents`; 100 000 and 5 000 000 → 202 (4 members)
Proof: `vp test test/integration/consultation/consultation.create.int.test.ts -t "enforces the amount bounds"`

**C44** · RF-201 — with no worker running, POST → 202 `{ id }` and all four attempts are `PENDING`
Proof: `vp test test/integration/consultation/consultation.create.int.test.ts -t "returns the id before any lender answers"`

**C45** · RF-202 — every consultation has exactly four attempts: `ALFA`, `BETA`, `GAMA`, `DELTA`
Proof: `vp test test/integration/consultation/consultation.create.int.test.ts -t "creates exactly one attempt per lender"`

**C46** · RF-108 — two POSTs with one key and one body → the same id, one consultation, four attempts, four lender jobs and one finalize job
Proof: `vp test test/integration/consultation/consultation.create.int.test.ts -t "replays an identical submission"`

**C47** · RF-109 — the same key with a different body → 422 `IDEMPOTENCY_KEY_REUSED`; the original consultation is unchanged
Proof: `vp test test/integration/consultation/consultation.create.int.test.ts -t "rejects a reused key with a different body"`

**C170** · RF-108 — an upper-case `Idempotency-Key` → 202, and the same UUID in lower case with the same body replays that consultation (added 2026-10-28, handoff fact-check F1)
Proof: `vp test test/integration/consultation/consultation.create.int.test.ts -t "treats the Idempotency-Key as one UUID whatever its letter case"`

**C48** · RF-110 — two submissions with one CPF (formatted, then unformatted) and different income/amount → one patient id; each consultation keeps its own income and amount
Proof: `vp test test/integration/consultation/consultation.create.int.test.ts -t "reuses the patient for a known CPF"`

**C49** · RF-215 — with `SIMULATION_CONTROLS=false`, a POST with `ALL_APPROVE` → 422 `SIMULATION_DISABLED`; `NORMAL` → 202
Proof: `vp test test/integration/consultation/consultation.simulation-gate.int.test.ts -t "rejects forced scenarios when controls are off"`

**C50** · RF-205, RF-803 — `DELTA_TIMES_OUT`: Delta ends `UNAVAILABLE`/`TIMEOUT`, the consultation is `SETTLED`, and `settledAt − createdAt ≤ CONSULTATION_DEADLINE_MS + 1000`
Proof: `vp test test/integration/consultation/consultation.orchestration.int.test.ts -t "times out a lender that never answers"`

**C51** · RF-206, RF-804 — `DELTA_FAILS`: Delta ends `UNAVAILABLE`/`LENDER_ERROR`; Alfa, Beta and Gama settle by their rules; exactly one `lender.call` log line exists for Delta's attempt
Proof: `vp test test/integration/consultation/consultation.orchestration.int.test.ts -t "isolates a lender 500 to that lender"`

**C52** · RF-209, RF-805 — `ALL_APPROVE`: calling `consultationService.finalize` while Delta is in flight sets Delta `TIMEOUT`; after Delta's answer arrives the attempt is still `TIMEOUT` with no Delta offer
Proof: `vp test test/integration/consultation/consultation.orchestration.int.test.ts -t "keeps the finalizer outcome when the worker answers late"`

**C53** · RF-202 — `NORMAL`: the four attempts' `calledAt` lie within 1000 ms of each other
Proof: `vp test test/integration/consultation/consultation.orchestration.int.test.ts -t "calls the four lenders in parallel"`

**C54** · RF-811 — each called attempt emits exactly one `lender.call` JSON line with `lender`, `attemptId`, `latencyMs`, `outcome`, `reason`; no captured line contains the CPF digits, the full name, the phone or the income value
Proof: `vp test test/integration/consultation/consultation.orchestration.int.test.ts -t "logs one PII-free line per lender call"`

**C55** · RF-214 — each forced scenario holds 20/20 consultations: `ALL_APPROVE` 4 `APPROVED`; `DELTA_FAILS` Delta `LENDER_ERROR`; `DELTA_TIMES_OUT` Delta `TIMEOUT`; `NONE_APPROVE` 0 offers and `journeyStatus` `NO_OFFER`
Proof: `vp test test/integration/consultation/consultation.scenarios.int.test.ts -t "each forced scenario holds 20 of 20"`

**C56** · RF-216 — with `SIMULATOR_DELTA_FAILURE_RATE=1`, after 20 `NORMAL` consultations the next Delta attempt settles `UNAVAILABLE`/`CIRCUIT_OPEN` with `calledAt` null
Proof: `vp test test/integration/lender/lender-attempt.breaker.int.test.ts -t "skips a lender whose circuit is open"`

**C57** · RF-217 — 30 s after the circuit opened, of two concurrent consultations exactly one Delta attempt has `breakerProbe = true` and a `calledAt`; the other is `CIRCUIT_OPEN`
Proof: `vp test test/integration/lender/lender-attempt.breaker.int.test.ts -t "lets exactly one probe through after 30 s"`

**C58** · RF-218 — after 20 `DELTA_FAILS` consultations, a `NORMAL` consultation's Delta attempt has a `calledAt` (not `CIRCUIT_OPEN`)
Proof: `vp test test/integration/lender/lender-attempt.breaker-forced.int.test.ts -t "ignores forced-scenario failures"`

**C160** · RF-214, RF-217, RF-218 — with Delta's circuit OPEN an `ALL_APPROVE` Delta attempt is `APPROVED`; under HALF_OPEN a `DELTA_FAILS` attempt is called (`LENDER_ERROR`) with `breakerProbe = false` and the state stays HALF_OPEN; the next `NORMAL` attempt is the probe (added 2026-10-28, audit A3 as amended by RFC D11)
Proof: `vp test test/integration/lender/lender-attempt.breaker-probe.int.test.ts -t "never hands the probe to a forced-scenario attempt"`

**C59** · RF-219 — with Delta disabled through `lenderSettingService.setEnabled`, the next Delta attempt is `UNAVAILABLE`/`DISABLED` with `calledAt` null; re-enabled, the next one is called
Proof: `vp test test/integration/lender/lender-setting.int.test.ts -t "skips a disabled lender without calling it"`

**C60** · RF-207 — GET mid-consultation returns four attempts ordered ALFA, BETA, GAMA, DELTA whose statuses equal the repository's
Proof: `vp test test/integration/consultation/consultation.read.int.test.ts -t "restores the current state on reload"`

**C61** · RF-205 — a GET past the deadline with no worker running turns every `PENDING` attempt into `UNAVAILABLE`/`TIMEOUT` and the consultation into `SETTLED`
Proof: `vp test test/integration/consultation/consultation.read.int.test.ts -t "lazily finalizes a read past the deadline"`

**C62** · RF-208 — the first event of every SSE connection, including a reconnect mid-consultation, is a `snapshot` equal to the GET body at that moment
Proof: `vp test test/integration/consultation/consultation.events.int.test.ts -t "starts every connection with a full snapshot"`

**C63** · RF-204 — `NORMAL`: the stream emits a snapshot where Alfa is settled while Delta is `PENDING`
Proof: `vp test test/integration/consultation/consultation.events.int.test.ts -t "streams per-lender updates"`

**C64** · RF-205 — the stream ends right after the first snapshot whose `quoteStatus` is `SETTLED`
Proof: `vp test test/integration/consultation/consultation.events.int.test.ts -t "closes after the settled snapshot"`

**C65** · RF-301 — `journeyStatus` derivation (4 members): choice → `CHOSEN`; offers → `OFFERS`; `SETTLED` without offers → `NO_OFFER`; otherwise `QUOTING`
Proof: `vp test src/server/modules/consultation/consultation.dto.test.ts -t "derives the journey status"`

**C66** · RF-302 — `suggestion` = the highest refusal hint that is ≥ 100 000 and < the requested amount; null with no such hint, and null when any offer exists
Proof: `vp test src/server/modules/consultation/consultation.dto.test.ts -t "suggests the highest usable hint"`

**C67** · RF-301, RF-302 — `NONE_APPROVE` with amount 1 000 000: reasons ALFA `AMOUNT_ABOVE_LIMIT`, BETA/GAMA/DELTA `PROFILE_NOT_ELIGIBLE`; `suggestion` 500 000
Proof: `vp test test/integration/consultation/consultation.read.int.test.ts -t "explains a no-approval outcome per lender"`

**C68** · RF-401 — `ALL_APPROVE` at 1 000 000: one offer per catalogue term per lender, at the canonical rate (ALFA `"0.024900"` × 6/12/18, BETA, GAMA, DELTA likewise)
Proof: `vp test test/integration/consultation/consultation.choice.int.test.ts -t "creates one offer per catalogue term"`

**C69** · RF-402 — the Alfa 12x offer for 1 000 000 has `installmentCents` 97 428 and `totalCents` 1 169 136
Proof: `vp test test/integration/consultation/consultation.choice.int.test.ts -t "prices offers with Tabela Price"`

**C70** · RF-403 — the Beta offer has `approvedCents` 600 000 and `approvedBelowRequested: true`; Alfa's is `false`
Proof: `vp test test/integration/consultation/consultation.choice.int.test.ts -t "flags offers below the requested amount"`

**C71** · RF-406 — choose → 200 with `choice.offerId`; a later GET returns the same choice
Proof: `vp test test/integration/consultation/consultation.choice.int.test.ts -t "persists a choice"`

**C72** · RF-407 — `ALL_APPROVE`: choosing an Alfa offer while Delta is `PENDING` → 200
Proof: `vp test test/integration/consultation/consultation.choice.int.test.ts -t "allows a choice while lenders are still quoting"`

**C73** · RF-408 — after settlement, choosing the same offer again → 200 with a body identical to the first
Proof: `vp test test/integration/consultation/consultation.choice.int.test.ts -t "re-choosing the same offer is idempotent"`

**C171** · RF-406, RF-408 — an upper-case `offerId` chooses that offer, and the same id in lower case afterwards is the same choice (200, not a conflict) (added 2026-10-28, handoff fact-check F2)
Proof: `vp test test/integration/consultation/consultation.choice.int.test.ts -t "accepts an offer id in either letter case"`

**C74** · RF-409 — choosing a different offer after a choice → 409 `CHOICE_CONFLICT`; the stored choice is unchanged; an offer of another consultation → 404 `OFFER_NOT_FOUND`
Proof: `vp test test/integration/consultation/consultation.choice.int.test.ts -t "rejects a different offer after a choice"`

**C75** · RF-805 — two concurrent chooses of different offers → exactly one 200 and one 409; the stored choice is the 200's offer
Proof: `vp test test/integration/consultation/consultation.choice.int.test.ts -t "serialises concurrent choices"`

**C76** · RF-410 — `ALL_APPROVE`: choose Alfa first; Delta later settles `APPROVED` with its offers recorded; the choice is unchanged
Proof: `vp test test/integration/consultation/consultation.choice.int.test.ts -t "records late answers without changing the choice"`

**C158** · RF-207 — GET, the SSE stream and choose for an unknown consultation id → 404 `CONSULTATION_NOT_FOUND` (3 members)
Proof: `vp test test/integration/consultation/consultation.read.int.test.ts -t "answers 404 for an unknown consultation"`
