# Boundaries: transactions, ordering, invariants

Read by every backend slice. "TX" = one `db.transaction`. Every state change is a **guarded** UPDATE (`WHERE <expected state>`). 0 rows means someone else won, which is never an error by itself.

## Create consultation (`consultation.service.create`), one TX

1. `INSERT … ON CONFLICT (idempotency_key) DO NOTHING RETURNING id` is attempted **last**, but the replay check runs first: `SELECT` by `idempotency_key`; if found, compare `request_hash`. Equal → return the existing id (202), no other effect. Different → `IDEMPOTENCY_KEY_REUSED`.
2. Validate the scenario gate (`SIMULATION_DISABLED`).
3. Upsert the patient by `cpf_hmac` (`patient.service`), then `SELECT … FOR UPDATE` the patient row (serialises concurrent creates for one CPF).
4. Count `consultation` rows for the patient within `RATE_LIMIT_PATIENT_WINDOW_HOURS`; ≥ max → `PATIENT_LIMIT` (rolls back the TX).
5. Insert the consultation (`deadline_at = now + CONSULTATION_DEADLINE_MS`) and 4 `PENDING` attempts (scenario copied).
6. `boss.send("lender.<code>", { attemptId }, { db: fromDrizzle(tx, sql) })` × 4 and `boss.send("consultation.finalize", { consultationId }, { db, startAfter: deadline_at })`.
7. Commit → 202 `{ id }`. A rollback leaves no row and no job (proven live).

A unique violation on `idempotency_key` racing step 1 is retried once as a replay.

## Lender job (`lender-attempt.job.ts` → `lender-attempt.service.run(attemptId)`)

1. **Pick** (TX): `UPDATE lender_attempt SET picked_at = now() WHERE id = $1 AND status = 'PENDING' AND picked_at IS NULL RETURNING …`. 0 rows → ack the job and stop (already settled or picked).
2. **Gate** (same TX, `pg_advisory_xact_lock(hashtext('breaker:' || lender))`):
   a. `lender_setting.enabled = false` → settle `UNAVAILABLE/DISABLED` (no call).
   b. Breaker (`circuit-breaker.ts`, below) `OPEN` → settle `UNAVAILABLE/CIRCUIT_OPEN` (no call).
   c. `HALF_OPEN` → if another `breaker_probe` attempt is in flight (called, not settled, < 30 s) → `CIRCUIT_OPEN`; else mark this attempt `breaker_probe = true`.
   d. Else set `called_at = now()`.
3. **Call** (outside any TX): `adapter.preApprove(req, AbortSignal.timeout(max(0, deadline_at − now)))`.
4. **Settle** (TX), guarded on `status = 'PENDING'`:
   - `APPROVED` → `pricing.service.createOffers(tx, attempt, result)` inserts one offer per term (`price.ts`), sets `approved_cents`, `monthly_rate`;
   - `REFUSED` → reason + hint; `LenderCallError` → `UNAVAILABLE` + its reason;
   - always `settled_at`, `latency_ms`.
     Then **settle the consultation** if no attempt is still `PENDING` (`UPDATE consultation SET quote_status='SETTLED', settled_at=now() WHERE id=$1 AND quote_status='QUOTING'`), then `SELECT pg_notify('consultation_updated', $consultationId)`. All in this TX, so delivery happens only after commit. 0 rows on the guarded attempt update (finalizer won) → discard the result. The late answer is lost by design, because the attempt is already `TIMEOUT`.
5. The handler never throws to pg-boss for lender failures (`retryLimit: 0`). Unexpected errors throw; the attempt stays `PENDING` until the finalizer.

## Finalize (`consultation.service.finalize(id)`), idempotent; used by the `consultation.finalize` job **and** lazily by every read once `now ≥ deadline_at`

One TX: `UPDATE lender_attempt SET status='UNAVAILABLE', reason='TIMEOUT', settled_at=now() WHERE consultation_id=$1 AND status='PENDING'` → settle the consultation (guarded) → `pg_notify` if anything changed.

## Choose (`consultation.service.choose(id, offerId)`), one TX

`SELECT consultation FOR UPDATE` → offer must belong to it (else `OFFER_NOT_FOUND`). `chosen_offer_id` null → set it and `chosen_at`, then notify. Equal → no-op, 200. Different → `CHOICE_CONFLICT`. Allowed while `QUOTING` (D24).

## Requote (`consultation.service.requote(sourceId, body, key)`)

Preconditions are checked on the source row: `quote_status='SETTLED'`, zero `APPROVED` attempts, `treatmentAmountCents < source amount`, else `REQUOTE_NOT_ALLOWED`. Then it runs the **same create path** (steps 1–7) with the source's patient, frozen income and birthdate, and age recomputed for today. The scenario is `NORMAL` unless the body sends one (gate applies). `request_hash` covers the body + source id.

## Circuit breaker (`circuit-breaker.ts`, pure)

Input: the lender's last 20 attempts with `simulation_scenario = 'NORMAL'`, `called_at IS NOT NULL`, `settled_at ≥ now − 5 min`, newest first, plus `now`.
`failures` = count with status `UNAVAILABLE` (`LENDER_ERROR` | `TIMEOUT` | `INTEGRATION_ERROR`).
State: `failures ≥ 16` and the newest failure < 30 s ago → `OPEN`; `failures ≥ 16` and the newest call ≥ 30 s ago → `HALF_OPEN`; else `CLOSED`. A successful probe produces a non-failure, so the window self-heals. Forced-scenario attempts never enter the window.

## Price (`price.ts`, pure, exact)

Rate string `"0.024900"` → `N = 24900`, `D = 1_000_000` (BigInt). `PV` in cents (BigInt), `n` integer.
`a = (D + N)^n`, `b = D^n`; installment = `PV·N·a / (D·(a − b))` rounded **half-up**: `(2·num + den) / (2·den)` with BigInt floor division. `total = installment × n`. Returns `number`s (cents ≤ 2^53).

## Scenarios (`simulator/scenario.ts`, pure)

| Scenario          | ALFA                               | BETA                    | GAMA                  | DELTA                                 |
| ----------------- | ---------------------------------- | ----------------------- | --------------------- | ------------------------------------- |
| `NORMAL`          | rule                               | rule                    | rule                  | rule                                  |
| `ALL_APPROVE`     | approve 100 %                      | approve 60 % (its rule) | approve 100 %         | approve 100 %, latency 4–8 s          |
| `DELTA_FAILS`     | rule                               | rule                    | rule                  | 500 always, latency 4–8 s             |
| `DELTA_TIMES_OUT` | rule                               | rule                    | rule                  | latency 12–15 s (beyond the deadline) |
| `NONE_APPROVE`    | refuse, hint = `floor(amount / 2)` | `DECLINED`              | refuse `IDADE_MINIMA` | `reject`, latency 4–8 s               |

Amended 2026-10-28 (implementation): a forced outcome must reach the worker before the 10 s deadline on every run, or it can't hold 20/20 (RF-214); Delta's NORMAL 4–15 s would turn ~45 % of `DELTA_FAILS`/`NONE_APPROVE` answers into `TIMEOUT`. Every forced Delta outcome is capped at 8 s, like `ALL_APPROVE`.

## Throttle (`throttle.plugin.ts`)

`onBeforeHandle` on the two POST routes: insert a `request_throttle` row (`ip_hmac` from `client-ip.ts`, `route`), **before** body validation, then count rows for `(ip_hmac, route)` in the window. Over the limit → 429 `IP_LIMIT`. `onAfterResponse` writes `status_code`/`error_code` on that row. With no `X-Forwarded-For` (dev without Caddy) the IP is the literal `"local"`.

## Realtime (`realtime/consultation-events.ts`)

One dedicated `pg.Client` per app process: `LISTEN consultation_updated`, reconnect with backoff, and after a reconnect it emits a synthetic "refresh all" to subscribers. SSE handler order: subscribe → read snapshot (lazily finalizes) → yield `sse({ event: "snapshot", data })` → loop: `race(nextNotification(id), sleep(2000), sleep-until-ping, abort(request.signal))` → re-read + yield. Stop after yielding a `SETTLED` snapshot. `finally` → unsubscribe.
