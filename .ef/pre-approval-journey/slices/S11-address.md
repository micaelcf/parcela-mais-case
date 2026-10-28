# S11 — the patient's address is collected by CEP and stored, and every input is a design-system component · ~35 files

Added 2026-10-28 (user request; RFC D27, D28; PRD RF-101, RF-111–RF-116). Built by two agents (`AddressServer`: `src/server/**`, `drizzle/**`, `test/integration/**`; `AddressUI`: `src/routes/**`, `src/components/**`, `src/api/**`, `src/hooks/**`, `test/e2e/**`) over the lead's shared contract `src/lib/address/address.ts`.
Reads: contract/api.md, contract/schema.md, contract/boundaries.md § Throttle, contract/frontend.md § Forms and validation, contract/bindings.md

**C176** · RF-111, RF-112 — step 1 shows only the CEP after the birthdate; a known CEP reveals street, number, complement, neighborhood, city and UF prefilled (city/UF read-only) and focuses the number
Proof: `vp run e2e test/e2e/address.spec.ts -g "shows the address fields only once the CEP is found"`

**C177** · RF-112 — the lookup is announced in a polite live region while it runs
Proof: `vp run e2e test/e2e/address.spec.ts -g "announces the lookup while it runs"`

**C178** · RF-112 — a new CEP refills street/neighborhood/city/UF and clears number/complement
Proof: `vp run e2e test/e2e/address.spec.ts -g "refills the address when the CEP changes"`

**C179** · RF-113 — an unknown CEP shows `CEP não encontrado` on the CEP field once it's left (RFC D30) and keeps the address fields hidden
Proof: `vp run e2e test/e2e/address.spec.ts -g "flags a CEP that doesn't exist once it's left"`

**C180** · RF-113 — `Próximo` with an unresolved CEP stays on step 1 with the error on the CEP field, never focusing a hidden field
Proof: `vp run e2e test/e2e/address.spec.ts -g "keeps Próximo on the step until the CEP resolves"`

**C181** · RF-114 — a 503 lookup reveals empty, editable fields (UF as the shadcn `Select`); the signup submits and the backoffice detail shows the typed address
Proof: `vp run e2e test/e2e/address.spec.ts -g "lets the patient type the address when the lookup is unavailable"`

**C182** · RF-115 — a create without `address` → 422; each invalid address part → 422 at its `address.<field>` path with its pt-BR message
Proof: `vp test test/integration/consultation/consultation.create.int.test.ts -t "address"`

**C183** · RF-115 — the backoffice detail shows the stored address normalised, the latest submission for the CPF winning; null for older patients
Proof: `vp test test/integration/backoffice/backoffice.lists.int.test.ts -t "shows the patient address normalised, the latest submission winning"`

**C184** · RF-115, RF-502 — public GET, SSE, choose and requote payloads never contain the street, number, neighborhood or CEP digits
Proof: `vp test test/integration/consultation/consultation.privacy.int.test.ts -t "public payloads carry no address"`

**C185** · RF-108, RF-109 — the address is part of the idempotency hash: the same address written differently replays; a different address → `IDEMPOTENCY_KEY_REUSED`
Proof: `vp test test/integration/consultation/consultation.create.int.test.ts -t "treats the address as part of the idempotent request"`

**C186** · RF-112, RF-113, RF-114 — `GET /api/addresses/:cep` against a fake ViaCEP: found (masked or bare) → 200; `erro` → 404 `CEP_NOT_FOUND`; 500/timeout/garbled → 503 `ADDRESS_LOOKUP_UNAVAILABLE`; malformed → 422 at `cep` without an upstream call (4 members)
Proof: `vp test test/integration/address/address.int.test.ts -t "answers"` and `-t "rejects a malformed CEP at the cep path without calling ViaCEP"`

**C187** · (no RF; RFC D27) — a repeated lookup is served from the cache; an unavailable answer is never cached
Proof: `vp test test/integration/address/address.int.test.ts -t "serves a repeated lookup from the cache, never an unavailable answer"`

**C188** · RF-811 — one log line per upstream lookup, never containing the CEP
Proof: `vp test test/integration/address/address.int.test.ts -t "logs each upstream call once without the CEP"`

**C189** · RF-116 — lookups past `RATE_LIMIT_LOOKUP_IP_MAX` → 429 `IP_LIMIT`, counted apart from create/requote (GET requests are counted in `transform`)
Proof: `vp test test/integration/address/address.int.test.ts -t "caps lookups per IP with their own limit"`

**C190** · (no RF; regression) — the real route answers through the Vite dev server with no request mock (a `*.client.*` server file was stubbed by TanStack Start's import protection and hung the server)
Proof: `vp run e2e test/e2e/address.spec.ts -g "answers a malformed CEP from the real route"`

**C191** · RF-104 (RFC D28) — the birthdate is a masked `dd/mm/aaaa` input with a calendar popover; picking from the month/year dropdowns fills it, by mouse and by keyboard (focus returns to the trigger); `31/02/1990` is invalid
Proof: `vp run e2e test/e2e/signup.spec.ts -g "picks the birthdate from the calendar"`, `vp run e2e test/e2e/a11y.spec.ts -g "picks the birthdate from the calendar by keyboard"`, `vp test src/lib/date/date-text.test.ts` (moved 2026-10-28; superseded in form by C204)

**C192** · RF-103, RF-104, RF-105 — a 422 and the form list every invalid field at once (12 here), past TypeBox's default `maxErrors` of 8 (now 64)
Proof: `vp test test/integration/consultation/consultation.create.int.test.ts -t "reports every invalid field at once, past TypeBox's default error cap"`, `vp test src/components/modules/signup/signup-form.test.ts -t "reports every invalid field at once, past TypeBox's error cap"`

**C193** · RF-612 — the backoffice detail shows the decrypted CPF and the address
Proof: `vp run e2e test/e2e/backoffice.spec.ts -g "shows the decrypted CPF and the address on the detail"`

**C194** · RF-614, RF-116 — CEP lookups from an IP stay out of the abuse figures (`requests`, limit hits, 429s, `topIps` cover create/requote only); throttle events still list them
Proof: `vp test test/integration/backoffice/backoffice.metrics.int.test.ts -t "summarises abuse in the last 24 h"`

**C195** · (no RF; regression guard for C190) — no file under `src/server` or `src/lib` is named `*.client.*`/`*.server.*` (TanStack Start strips those per environment); a planted `probe.client.ts` made it fail
Proof: `vp test src/server/server-file-names.test.ts`
