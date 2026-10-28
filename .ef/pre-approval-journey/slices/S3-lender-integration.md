# S3 — the four simulated lenders answer per the PDF, adapters map them to one canonical result, and the breaker state derives correctly · ~14 files · est. ~7k

Wave 1. Owns: `src/server/integrations/lenders/simulator/**`, `src/server/integrations/lenders/lender.port.ts`, `src/server/integrations/lenders/{alfa,beta,gama,delta}/**`, `src/server/integrations/lenders/registry.ts`, `src/server/integrations/lenders/adapters.test.ts`, `src/server/modules/lender/circuit-breaker.ts`, `src/server/modules/lender/circuit-breaker.test.ts`
Reads: contract/bindings.md, contract/layout.md, contract/signatures.md, contract/lender-port.md, contract/api.md, contract/boundaries.md

Non-goals: no DB access, no queue, no attempt persistence, no registration in `app.ts` (S4 mounts `simulatorPlugin`). Export exactly the names in `signatures.md` § S3. Tests mount the simulator standalone (`new Elysia().use(createSimulatorPlugin({ timeScale, deltaFailureRate }))`) and use `timeScale ≤ 0.01` unless a check measures latency.

**C24** · RF-210 — Alfa `NORMAL` with income R$ 1.000,00: amount R$ 10.000,00 → `aprovado: true`, `valor_aprovado` 10000.00; amount R$ 10.000,01 → `aprovado: false`, `motivo: "RENDA_INSUFICIENTE"`, `limite_maximo` 10000.00
Proof: `vp test src/server/integrations/lenders/simulator/simulator.plugin.test.ts -t "Alfa approves at income × 10 and refuses one cent above"`

**C25** · RF-211 — Beta `NORMAL` approves `round_half_up(amount × 0.6)`: 100 001 → 60 001 cents; 1 000 000 → 600 000 cents (HTTP 201)
Proof: `vp test src/server/integrations/lenders/simulator/simulator.plugin.test.ts -t "Beta approves 60% rounded half up"`

**C26** · RF-212 — Gama `NORMAL`: age 24 → `RECUSADO`/`IDADE_MINIMA`; amount 2 000 001 → `RECUSADO`/`VALOR_MAXIMO` with `tetoCentavos` 2 000 000; age 25 with 2 000 000 → `APROVADO` 2 000 000
Proof: `vp test src/server/integrations/lenders/simulator/simulator.plugin.test.ts -t "Gama refuses under 25 or above 20.000 reais"`

**C27** · RF-213 — Delta `NORMAL` with failure rate 0.3 over 200 calls: the HTTP 500 share is within [23 %, 37 %] and every other call approves 100 % of the amount
Proof: `vp test src/server/integrations/lenders/simulator/simulator.plugin.test.ts -t "Delta fails about 30% of NORMAL calls"`

**C28** · RF-210, RF-211, RF-212, RF-213 — latency range table (ms, before scaling): ALFA 500–1500, BETA 2000–5000, GAMA 1000–3000, DELTA 4000–15000 in `NORMAL`; DELTA 4000–8000 in `ALL_APPROVE`; DELTA 12000–15000 in `DELTA_TIMES_OUT`
Proof: `vp test src/server/integrations/lenders/simulator/scenario.test.ts -t "latency ranges follow the PDF"`

**C29** · RF-210 — a measured Alfa call at `timeScale 0.1` answers in no less than 50 ms and no more than 200 ms
Proof: `vp test src/server/integrations/lenders/simulator/simulator.plugin.test.ts -t "applies the scaled latency"`

**C30** · RF-214 — forced scenarios override all 16 lender × scenario cells exactly as `boundaries.md` § Scenarios (`ALL_APPROVE` 4 approvals, Beta at 60 %; `DELTA_FAILS` Delta 500 on 20/20 calls; `DELTA_TIMES_OUT` Delta latency ≥ 12 000 ms scaled; `NONE_APPROVE` 4 refusals), regardless of income, age or amount
Proof: `vp test src/server/integrations/lenders/simulator/simulator.plugin.test.ts -t "forced scenarios override every lender"`

**C31** · RF-205 — aborting the caller's request during a `DELTA_TIMES_OUT` sleep ends the simulator handler within 100 ms of the abort
Proof: `vp test src/server/integrations/lenders/simulator/simulator.plugin.test.ts -t "stops sleeping when the caller aborts"`

**C32** · RF-401 — each adapter maps its approval to the canonical result: ALFA `"0.024900"` [6,12,18], BETA `"0.019900"` [12,18,24], GAMA `"0.032900"` [6,10,12], DELTA `"0.021900"` [12,24,36], `approvedCents` exact (Alfa's BRL decimals converted half-up)
Proof: `vp test src/server/integrations/lenders/adapters.test.ts -t "maps approvals to canonical rates and terms"`

**C33** · RF-301 — refusals map to canonical reasons (5 members): Alfa `RENDA_INSUFICIENTE` → `AMOUNT_ABOVE_LIMIT` with hint; Gama `VALOR_MAXIMO` → `AMOUNT_ABOVE_LIMIT` hint 2 000 000; Gama `IDADE_MINIMA` → `PROFILE_NOT_ELIGIBLE` hint null; Beta `POLICY` and Delta `risk` → `PROFILE_NOT_ELIGIBLE`
Proof: `vp test src/server/integrations/lenders/adapters.test.ts -t "maps refusals to canonical reasons"`

**C34** · RF-302 — in `NONE_APPROVE`, Alfa's refusal hint maps to `maxApprovableCents = floor(amount / 2)` (amount 1 000 001 → 500 000)
Proof: `vp test src/server/integrations/lenders/adapters.test.ts -t "NONE_APPROVE Alfa hints half the amount"`

**C35** · RF-206 — a Delta HTTP 500 throws `LenderCallError` with reason `LENDER_ERROR`
Proof: `vp test src/server/integrations/lenders/adapters.test.ts -t "maps a 5xx to LENDER_ERROR"`

**C36** · RF-205 — a call whose signal aborts before the answer throws `LenderCallError` with reason `TIMEOUT`
Proof: `vp test src/server/integrations/lenders/adapters.test.ts -t "maps an aborted call to TIMEOUT"`

**C37** · (no RF; A19) a network failure, a non-JSON 200, an unknown 200 shape and a 4xx each throw `LenderCallError` with reason `INTEGRATION_ERROR` (4 members; stub `fetch`)
Proof: `vp test src/server/integrations/lenders/adapters.test.ts -t "maps unusable responses to INTEGRATION_ERROR"`

**C38** · RF-216 — 16 failures among the last 20 samples with the newest failure 10 s ago → `OPEN`; 15 failures → `CLOSED`
Proof: `vp test src/server/modules/lender/circuit-breaker.test.ts -t "opens at 16 failures in the last 20"`

**C39** · RF-217 — 16 failures with the newest call 30 000 ms ago → `HALF_OPEN`; 29 999 ms ago → `OPEN`
Proof: `vp test src/server/modules/lender/circuit-breaker.test.ts -t "half-opens 30 s after the newest call"`

**C40** · RF-216 — samples settled more than 5 min before `now` don't count, and `REFUSED` or `APPROVED` samples aren't failures (both → `CLOSED`)
Proof: `vp test src/server/modules/lender/circuit-breaker.test.ts -t "counts only recent lender failures"`
