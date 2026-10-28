# S6 — a refused patient can requote, abuse is capped per patient and per IP, and public payloads leak no PII · ~12 files · est. ~14k

Wave 3. Owns: `src/server/modules/throttle/**` (except `db/`), `src/server/infra/http/client-ip.ts`, `src/server/infra/http/client-ip.test.ts`, `test/integration/consultation/consultation.{requote,limits,privacy}.int.test.ts`, `test/integration/throttle/**`
Except: `src/server/modules/consultation/consultation.{service,repository,routes,dto}.ts` and `src/server/worker.ts` were written by S4; this slice extends them (requote, patient cap, throttle wiring, purge job registration). Deliberate: S4 has landed before this wave starts, so nobody else writes them.
Reads: contract/bindings.md, contract/layout.md, contract/schema.md, contract/api.md, contract/boundaries.md, contract/signatures.md

Non-goals: no backoffice route, no UI. Integration tests run on real Postgres under `test/integration/`.

**C89** · RF-303 — requote of a `NONE_APPROVE` consultation → 202 with a new id; same patient; frozen income and birthdate equal to the source; amount equal to the requested one
Proof: `vp test test/integration/consultation/consultation.requote.int.test.ts -t "requotes for the same patient with a lower amount"`

**C90** · RF-304 — requote → 409 `REQUOTE_NOT_ALLOWED` when the source is still `QUOTING`, when it has an `APPROVED` attempt, and when the amount isn't lower (3 members); the patient's consultation count is unchanged after each
Proof: `vp test test/integration/consultation/consultation.requote.int.test.ts -t "refuses a requote that isn't allowed"`

**C91** · RF-305 — two requotes with one `Idempotency-Key` → the same new id and one new consultation
Proof: `vp test test/integration/consultation/consultation.requote.int.test.ts -t "replays a requote"`

**C92** · RF-306 — requote of a `NONE_APPROVE` consultation without `simulationScenario` → the new consultation's scenario is `NORMAL`
Proof: `vp test test/integration/consultation/consultation.requote.int.test.ts -t "requotes in NORMAL by default"`

**C93** · RF-504 — with `RATE_LIMIT_PATIENT_MAX=5`, the 6th create for one CPF inside the window → 429 `PATIENT_LIMIT` with a pt-BR `detail`; a requote by that patient → 429 too
Proof: `vp test test/integration/consultation/consultation.limits.int.test.ts -t "refuses a patient over the cap"`

**C94** · RF-505 — with `RATE_LIMIT_IP_MAX=3`, the 4th POST from one IP → 429 `IP_LIMIT`, counting earlier 422 responses; another IP is still accepted; requote shares the guard
Proof: `vp test test/integration/throttle/throttle.int.test.ts -t "refuses an IP over the cap counting invalid requests"`

**C95** · RF-614 — each counted request's `request_throttle` row ends with its `status_code` and `error_code` (`202`/null, `422`/`VALIDATION`, `429`/`IP_LIMIT`, `429`/`PATIENT_LIMIT`)
Proof: `vp test test/integration/throttle/throttle.int.test.ts -t "records the outcome of each counted request"`

**C96** · (no RF; data lifecycle) the `throttle.purge` job deletes rows older than the IP window + 24 h and keeps newer ones
Proof: `vp test test/integration/throttle/throttle.int.test.ts -t "purges rows past retention"`

**C97** · RF-506 — the counted IP is the `X-Forwarded-For` value Caddy sets (first entry), and the literal `"local"` without the header
Proof: `vp test src/server/infra/http/client-ip.test.ts -t "reads the proxy-set address"`

**C98** · RF-501 — public GET, every SSE snapshot, choose and requote responses: after removing UUID and ISO-timestamp strings, no string value contains any 3-digit window of the patient's CPF, no key contains `cpf`/`document`/`taxId`, and no `*`/`•` mask appears
Proof: `vp test test/integration/consultation/consultation.privacy.int.test.ts -t "public payloads carry no CPF digits"`

**C99** · RF-502 — the same payloads contain neither the birthdate, the phone digits, the income value nor the surname; `patientFirstName` is the first name
Proof: `vp test test/integration/consultation/consultation.privacy.int.test.ts -t "public payloads carry only the first name"`

**C100** · RF-503 — after a submission, a read-only scan of every text, varchar and bytea column of every table (raw `pg` over `information_schema`) finds the 11 CPF digits neither as text nor as bytes
Proof: `vp test test/integration/consultation/consultation.privacy.int.test.ts -t "never stores the CPF in plaintext"`
