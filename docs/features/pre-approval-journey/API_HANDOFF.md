# API handoff: pre-approval journey

For any client that isn't the bundled SPA: a mobile app, a partner backend, a second frontend. It was written from the code on 2026-10-28 and checked against the running dev stack (`SIMULATION_CONTROLS=true`, default limits). **Where this document and the RFC, PRD or `.ef/…/contract/api.md` disagree, this document wins.** It describes what shipped.

Ground truth, if this document is ever wrong:

- Routes: `src/server/app.ts`, `src/server/modules/*/*.routes.ts`, `src/server/modules/system/system.routes.ts`, `src/server/integrations/lenders/simulator/simulator.plugin.ts`
- Wire shapes: `src/server/modules/consultation/consultation.dto.ts`, `src/server/modules/backoffice/backoffice.dto.ts`, `src/lib/list/list-contract.ts`, `src/lib/address/address.ts` (address rules, the 27 UFs, `AddressLookup`), `src/lib/phone/phone.ts`
- CEP lookup: `src/server/modules/address/*`, `src/server/integrations/viacep/viacep.adapter.ts`
- Errors: `src/server/lib/errors/domain-error.ts`, `src/server/infra/http/errors.plugin.ts`
- Limits: `src/server/modules/throttle/*`, `src/server/modules/consultation/consultation.service.ts`
- Env: `src/server/infra/env/server-env.ts`

There's no OpenAPI document. No route declares a `response` schema, so the TypeBox response schemas describe the payloads but nothing enforces them at runtime (see D10 below).

---

## 1. Divergences from the spec

| #   | Spec says                                                                          | Reality                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Build against                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `api.md` § Errors: `fields: [{ path: "patient.cpf", … }]`                          | Paths are the property names of the request part that failed: `cpf`, `treatmentAmountCents`, `idempotency-key` (lower-case header name), `lender` or `cep` (path params), `pageSize` (query). The only nested request object is the signup `address`, whose paths are `address.<field>` (`address.cep`, `address.state`); a missing `address` object is `path: "address"`. A failure of the body as a whole has `path: ""`: no `Content-Type` (`Valor inválido`), and `Campo não permitido` when a search-by-cpf extra key is neither a string nor a number.                                                                                                                                                                                                                                                                                                  | Match on `path` equal to the field or header name (dotted for `address.*`). Treat `""` as "the whole body".                                                |
| D2  | AD14, D24, RF-408: re-choosing the same offer gives "200 with the same body"       | 200 with the **current** view. While lenders are still quoting, new attempts and offers make the body differ. Observed: the first choose returned 3 offers, a re-choose 1.5 s later returned 9. Only `choice` is guaranteed identical (RFC O6, still open).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Compare `choice.offerId` and `choice.chosenAt`, never the whole body.                                                                                      |
| D3  | `api.md`: SSE sends `ping` every 15 s                                              | `ping` is sent only after 15 s with no `snapshot`. The stream closes once `quoteStatus` is `SETTLED`, which happens at most ≈ 2 s after `deadlineAt`. With the default 10 s deadline (`CONSULTATION_DEADLINE_MS`) a `ping` is effectively never sent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Don't use `ping` as a liveness signal. Use your own read timeout (e.g. `deadlineAt` + 5 s).                                                                |
| D4  | RFC D9: re-reads and **emits** on each NOTIFY, plus every 2 s                      | It re-reads on each NOTIFY and at least every 2 s, but emits a `snapshot` only when the serialized view changed. Snapshots carry no `id:` and no `retry:`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Each snapshot is a full replacement. Quiet periods are normal.                                                                                             |
| D5  | RF-603: after logout, `/api/backoffice/*` → 401                                    | `DELETE /api/backoffice/session` only sends an expired `Set-Cookie`. The session is stateless (`"<username>\|<expiresAt>"`, signed), so a copy of the cookie stays valid until its 8 h expiry. Observed: the old cookie still got `200 {"username":"operador"}` after logout. Only rotating `BACKOFFICE_SESSION_SECRET` (or changing `BACKOFFICE_USERNAME`) revokes sessions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Logout means "discard the cookie". Protect the cookie like a password.                                                                                     |
| D6  | `api.md` § Backoffice: auth runs in `derive` + `onBeforeHandle`                    | The session is checked in `parse`/`transform`, before the body is read and before validation. Any guarded request without a valid session gets 401, even with an invalid body. Login (`POST /session`) isn't guarded, so it does return 422.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Expect 401 to take precedence over 422 on every guarded route.                                                                                             |
| D7  | `api.md`: `/api/*` mounted for GET, POST, PUT, DELETE                              | PATCH is mounted too, with no PATCH routes, so it gets 404 `NOT_FOUND`. `HEAD /api/*` → 404 problem+json. `OPTIONS /api/*` is answered by the SPA shell with **200 `text/html`**, not a CORS preflight.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Don't send HEAD/OPTIONS. Browsers on another origin can't call the API (§ 7).                                                                              |
| D8  | `api.md`: validation → `fields` with pt-BR messages                                | Messages aren't one per field. One bad value can yield 2–3 entries with the same `path`. Numeric bounds use generic text (`"Deve ser no mínimo 100000"`). Any string value, numeric or not, that fails an integer field can leak TypeBox English (`"must be integer"`). That covers every failing integer in a query string or form body, and a JSON string in the body (`"treatmentAmountCents":"50000"`); a failing JSON number doesn't leak it. Only the first request part to fail is reported, and the body is checked first: an invalid path param or a missing header surfaces only once the body is valid. Within that part every invalid field is listed: TypeBox's `maxErrors` is raised from 8 to 64 (`src/lib/validation/standard-schema.ts:13`). Observed: a body with 13 bad fields returned 17 entries, `simulationScenario` included (§ 9.2). | Branch on `code` and `path`. Show the messages, never parse them. `fields` is complete for the body, but a header or param error can still hide behind it. |
| D9  | `api.md` § Lender simulator: Alfa/Beta/Gama have no failure answer                 | Every simulated lender answers `500 {"error":"internal"}` for a `FAIL` outcome, but only Delta ever gets one (≈ 30 % in `NORMAL`, i.e. `SIMULATOR_DELTA_FAILURE_RATE` = 0.3 by default; always in `DELTA_FAILS`). Any simulated lender answers **499 with an empty body** when the caller aborts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Informational. The simulator isn't a consumer API (§ 3.4).                                                                                                 |
| D10 | `ConsultationDetailSchema` (`backoffice.dto.ts`)                                   | `GET /api/backoffice/consultations/:id` adds undeclared fields: each attempt also has `consultationId` and `simulationScenario`, and each offer also has `attemptId` and `consultationId` (rows are spread into the response, and there's no response schema).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Ignore unknown fields. Don't depend on the undeclared ones.                                                                                                |
| D11 | RFC D15 "each consultation freezes its decision inputs"; RFC D13 "first name only" | `patientFirstName` is the first word of the patient's **current** `fullName`. Every new submission with the same CPF overwrites the name, birthdate, phone, e-mail and address (`patient.repository.ts:33-57`), and every consultation of that patient, old ones included, then shows the new first name (`consultation.repository.ts:140`). Decision inputs (income, amount, birthdate, age) stay frozen. The address and e-mail aren't frozen per consultation: the backoffice detail shows the patient's latest ones. A resubmission **without** `email` clears it. Observed: a second create for the same CPF with no `email` turned the first consultation's `patient.email` from `"ana.lima@exemplo.com"` into `null`.                                                                                                                                  | Don't treat `patientFirstName`, `patient.email` or `patient.address` as historical.                                                                        |
| D12 | `boundaries.md`/RF-614: each throttle row records the error code the client got    | **Fixed before handoff (2026-10-28):** a malformed JSON body is answered `422 VALIDATION` and now recorded as `422`/`VALIDATION` (`throttle.plugin.ts:15-27` maps `ParseError`). Rows written before the fix read `422`/`INTERNAL`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Treat `422`/`INTERNAL` rows in old data as malformed JSON; new rows match the response.                                                                    |
| D13 | RFC D22/RF-506: the counted IP comes only from a proxy-overwritten header          | That holds only behind Caddy. Hitting the app directly (dev `http://localhost:3000`, or any deployment without Caddy) trusts **any client-supplied `X-Forwarded-For`** (its first entry). Without the header every caller counts as one IP, `"local"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Always go through the proxy in production. Under rootless Podman the real peer IP is still unverified (RFC O5).                                            |
| D14 | AD18: `deadline_at = created_at + 10 s`                                            | `deadlineAt = createdAt + CONSULTATION_DEADLINE_MS`. The default is 10 000 ms, but it's configurable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Read `deadlineAt` from the payload. Never hard-code 10 s.                                                                                                  |
| D15 | `api.md`: money is `number`, integer                                               | Requests are coerced: `"monthlyIncomeCents": "800000"` (a string) was accepted with 202. Fractions are rejected (`150000.5` → 422).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Send JSON integers. Don't rely on the coercion.                                                                                                            |

---

## 2. Traps

**Idempotency**

- **A replay is indistinguishable from a new create.** Both answer `202 {"id":"…"}`, with no header or flag to tell them apart. A replay returns the original id, even after the patient has reached the cap and even after `SIMULATION_CONTROLS` was switched off, because the replay check runs first (`consultation.service.ts:102`).
- **Keys are global**, shared by create and requote. A create's key reused on a requote (or the reverse) → 422 `IDEMPOTENCY_KEY_REUSED`.
- **What counts as "the same body"** is a hash of the normalised fields: trimmed `fullName`, CPF digits, `birthdate`, the phone's 11 national digits, the e-mail (trimmed and lower-cased; absent ≡ `""`), income, amount, scenario (absent ≡ `"NORMAL"`), and the address (CEP digits, every text field trimmed, a blank `complement` dropped). `"036.567.567-91"` and `"03656756791"` replay, and so do `"+55 11 98765-4321"` and `"11987654321"`, `"  Ana.Lima@Exemplo.COM "` and `"ana.lima@exemplo.com"`, `"01310-100"` and `"01310100"`, and `"Apto 42"` and `" Apto 42 "`. `"Mariana  Alves"` (double space) doesn't replay, and neither does a different house `number`, nor **adding or removing `email`** under the same key (observed: dropping it → 422 `IDEMPOTENCY_KEY_REUSED`). For a requote the hash is the source id + amount + scenario.
- **Letter case doesn't matter.** `Idempotency-Key` accepts a UUID in upper or lower case, and the server lower-cases it before storing it, so `7A1D…` and `7a1d…` are **one** key. Observed: an upper-case create followed by the same key in lower case → the same id. The same goes for the requote source id inside the requote hash, for `offerId` in choose, and for the consultation `:id`, which is lower-cased on read, events, choice and requote. An upper-case stream gets the same pushes as a lower-case one: observed frames at the same moments on both. Responses always carry lower-case ids.
- **On requote, business checks run before the idempotency check.** Reusing a key with a non-lower amount gives 409 `REQUOTE_NOT_ALLOWED`, not 422.

**Rate limits**

- **Every request to a throttled route counts**, whatever its outcome: 202, 422, malformed JSON, replays, 404 (unknown requote source), 409, and the rejected 429s themselves. The window is rolling, so a client that keeps retrying while it's limited keeps itself limited.
- **The IP limit is per (IP, route).** `POST /api/consultations`, `POST /api/consultations/:id/requote` and `GET /api/addresses/:cep` each have their own bucket. The CEP lookup's cap is `RATE_LIMIT_LOOKUP_IP_MAX` (120 per window by default), not `RATE_LIMIT_IP_MAX`.
- **A partner backend has one egress IP.** It gets one bucket per route for **all** its patients: by default 30 creates, 30 requotes and 120 CEP lookups per hour. With ≥ 4 lookups per signup, the lookup cap binds before the create cap. Raise `RATE_LIMIT_IP_MAX`, `RATE_LIMIT_LOOKUP_IP_MAX` and/or `RATE_LIMIT_IP_WINDOW_MINUTES` before integrating a server-to-server client.
- **429s carry no `Retry-After` header.**

**Validation**

- **`simulationScenario`: omit it or send a valid value.** `null` → 422 `"Opção inválida"`.
- **`Content-Type: application/json` is required.**
  - Any other content type Elysia doesn't parse into an object (e.g. `text/plain`, what `fetch` sends for a string body with no headers, or `application/xml`) → 422 `VALIDATION`, detail `Envie o corpo como JSON (Content-Type: application/json).`, no `fields`, on every body route: POST, PUT, PATCH, DELETE (`errors.plugin.ts`). A GET/HEAD/OPTIONS ignores its `Content-Type` (e.g. the CEP lookup keeps its `cep` field error).
  - No `Content-Type` at all → 422 `VALIDATION`, `fields: [{ "path": "", "message": "Valor inválido" }]`.
  - `application/x-www-form-urlencoded` and `multipart/form-data` bodies are **accepted**, with values coerced like JSON strings. Observed: a form-encoded choose → 200, a form-encoded requote reached its business rules (409), and a multipart choose reached the offer lookup (404 `OFFER_NOT_FOUND`). Don't rely on that.
- **Unknown request properties are silently ignored**: `{"foo":"bar"}` alongside a valid body → 202.
- **`monthlyIncomeCents: 0` is valid.** The lower bound is 0, not 1.
- **`phone` must be a Brazilian mobile number**: a real area code (one of the 67 DDDs), then `9` and 8 digits. Separators `() + . -` and spaces are allowed, and a `+55`/`55` country code or a `0` trunk prefix is dropped (`+55 11 98765-4321` → stored `11987654321`). Landlines, other countries, unknown area codes and one repeated digit (`(99) 99999-9999`) are refused, each with a message (§ 4.1).
- **`email` is optional: omit it or send a valid address.** `""` → 422 `email` / `Informe um e-mail válido, ex.: nome@exemplo.com` (empty isn't "absent"), and `null` → 422 `email` / `Valor inválido`. The domain needs a dot and a 2+ letter TLD: `ana@clinica` is refused. The address is stored trimmed and lower-cased, and never appears in a public payload.
- **The `birthdate` message is misleading.** A badly formatted `birthdate` (`"14/05/1990"`) gets the age message `"A idade deve estar entre 18 e 80 anos"`, not a format message. Age is computed against the server's local date, not the client's, so near midnight a birthday can land on a different day than it does in Brazil (UTC−3).

**Address and CEP lookup**

- **`address` is required on create** and validated field by field, with paths `address.<field>` (§ 4.1). `{}` → one `Campo obrigatório` per required field, plus `address.state` / `Selecione a UF`.
- **`complement`: omit it or send a string.** `null` → 422 `address.complement` / `Valor inválido`. A blank or whitespace-only complement is accepted and dropped, so it hashes the same as an omitted one.
- **`state` must be an upper-case UF** from the 27 (`"SP"`, not `"sp"`): anything else → `Selecione a UF`.
- **The server doesn't cross-check the address.** On submit, nothing verifies that the CEP exists, or that it matches `city`/`state`/`street`, and nothing calls ViaCEP. A create never fails because the lookup is down. Consistency is the client's job (§ 8).
- **A lookup 200 can have empty `street` and `neighborhood`** (`""`, not `null`): ViaCEP has city-wide CEPs. Observed: `69945000` → `{"cep":"69945000","street":"","neighborhood":"","city":"Acrelândia","state":"AC"}`. The user must then type them, since a blank `street`/`neighborhood` is rejected on create.
- **Lookup answers are cached in the app process**, not shared between processes and lost on restart. Found: 24 h. Not found: 1 h, so a CEP ViaCEP learns later keeps answering 404 for up to an hour. Unavailable (503): never cached, so a retry tries ViaCEP again.
- **Every lookup counts against its IP bucket**, including cache hits, 404s and malformed CEPs (the cap is checked before validation, so 429 beats 422).
- **The address never appears in public payloads.** It's stored on the patient and shown only in the backoffice consultation detail.

**Consultation view and SSE**

- **The public view never omits a key.** Every field in § 4.2 is always present. "Nothing yet" is `null` (`settledAt`, `choice`, `suggestion`, per-attempt `reason`/`approvedCents`/`monthlyRate`/`settledAt`) or `[]` (`offers`). `attempts` always has exactly 4 entries.
- **`journeyStatus` and `quoteStatus` are two axes.** `CHOSEN` + `QUOTING` is a normal state: a choice was made while lenders are still answering (RF-407). `OFFERS` + `SETTLED` means the quote finished and nothing was chosen yet.
- **The SSE stream ends at `SETTLED`, not at `CHOSEN`.** Opening the stream for an already settled consultation yields exactly one `snapshot` and then EOF. A choice made after settlement is never pushed to anyone: use the response of `POST …/choice`.
- **`suggestion` appears only when `journeyStatus` is `NO_OFFER`.** It's derived from lenders' refusal hints, and the hints themselves are never public. In `NORMAL` it can equal income × 10 (RFC O9), so it reveals income to anyone holding the link.
- **`monthlyRate` is a 6-decimal fraction string.** `"0.024900"` is 2.49 % a.m., not 0.0249 %. Parse it as a decimal; never multiply money by a float.

**Ordering and identity**

- **Offer ids are UUIDv7 with random low bits, so they aren't sorted by term** inside one lender. The server sorts offers by lender (ALFA, BETA, GAMA, DELTA), then by `termMonths`. Keep that order or sort client-side, but never by id.
- **The consultation id is the only credential on the public routes.** Anyone holding it can read the consultation, choose an offer and requote (§ 6.1).

**Backoffice session**

- **The `bo_session` cookie has `Path=/api/backoffice`.** A cookie jar scoped to `/` won't send it. Its value is URL-encoded and signed. Send it back verbatim.
- **`Secure` is set only when the server has `APP_DOMAIN`.** Over plain `http://` (dev, `up --prod` without a domain) the cookie has no `Secure` flag. With `APP_DOMAIN` set, a client on `http://` loses the cookie.

---

## 3. Every surface

Base URL: `<origin>/api`. Locally that's `http://localhost:3000/api` (dev, no proxy). The `up --prod` stack is reached through Caddy on `HTTP_PORT` (default 8080), with HTTPS on `HTTPS_PORT` (8443) when `APP_DOMAIN` is set. Send every body as JSON with `content-type: application/json` (other content types: § 2). Success responses are `application/json`, errors are `application/problem+json`, and 204s have no body.

### 3.1 Public consultation API (capability URLs, no authentication)

| Method | Path                             | Gates                                                                                     | Success                                                                                                  |
| ------ | -------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| POST   | `/api/consultations`             | IP throttle `consultation.create`; header `Idempotency-Key` (UUID, either case) required  | **202** `{ "id": "<uuid>" }`                                                                             |
| GET    | `/api/consultations/:id`         | none                                                                                      | 200 `ConsultationPublicView`. A read past the deadline finalizes the consultation (it can write).        |
| GET    | `/api/consultations/:id/events`  | none                                                                                      | 200 `text/event-stream` (§ 4.3). If the consultation is unknown: a 404 problem+json instead of a stream. |
| POST   | `/api/consultations/:id/choice`  | none (not throttled, no idempotency key: naturally idempotent)                            | 200 `ConsultationPublicView`                                                                             |
| POST   | `/api/consultations/:id/requote` | IP throttle `consultation.requote`; header `Idempotency-Key` (UUID, either case) required | **202** `{ "id": "<uuid of the NEW consultation>" }`                                                     |

`:id` that isn't a UUID → 404 `CONSULTATION_NOT_FOUND` (not 422) on GET, events, choice and requote. The id is case-insensitive: the server lower-cases it on every one of these routes. Ids in responses are always lower case.

### 3.1.1 CEP lookup (public, no authentication)

| Method | Path                  | Gates                                                                                                   | Success                       |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------- |
| GET    | `/api/addresses/:cep` | IP throttle `address.lookup` (`RATE_LIMIT_LOOKUP_IP_MAX`, default 120 per window); `:cep` must be a CEP | 200 `AddressLookup` (§ 4.1.1) |

Errors: 422 `VALIDATION` at `path: "cep"` (`CEP inválido`) · 404 `CEP_NOT_FOUND` · 503 `ADDRESS_LOOKUP_UNAVAILABLE` · 429 `IP_LIMIT`. A GET has no body, so its `Content-Type` is ignored and a malformed CEP always gets the `cep` field error. Observed: `Content-Type: text/plain` on `/api/addresses/12345` → 422 `fields:[{"path":"cep","message":"CEP inválido"}]`. It's backed by ViaCEP; clients must not call ViaCEP themselves (§ 8).

### 3.2 System (public)

| Method | Path          | Success                                                                                                                                                             |
| ------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health` | 200 `{ "status": "ok", "sha": "<GIT_SHA>" }`. `GIT_SHA` defaults to `"dev"`; the dev stack reports `"local"`. Process liveness only: it doesn't check the database. |
| GET    | `/api/config` | 200 `{ "simulationControls": boolean }`, the value of `SIMULATION_CONTROLS` (default `false`).                                                                      |

### 3.3 Backoffice (`/api/backoffice`, single operator)

Every route except `POST /session` requires a valid `bo_session` cookie. Otherwise: 401 `UNAUTHENTICATED`, before parsing or validation.

| Method | Path                                          | Request                                                                    | Success                                                                                                                                                             |
| ------ | --------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/backoffice/session`                     | `{ username, password }`                                                   | **204** + `Set-Cookie: bo_session=…; Max-Age=28800; Path=/api/backoffice; HttpOnly; SameSite=Lax[; Secure]`                                                         |
| GET    | `/api/backoffice/session`                     | none                                                                       | 200 `{ "username": string }`                                                                                                                                        |
| DELETE | `/api/backoffice/session`                     | none                                                                       | **204** + `Set-Cookie: bo_session=…; Max-Age=0; Path=/api/backoffice; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax[; Secure]` (doesn't revoke, D5) |
| GET    | `/api/backoffice/metrics/pipeline`            | `?from&to&bucket=day\|hour`                                                | 200 `PipelineMetrics`                                                                                                                                               |
| GET    | `/api/backoffice/metrics/lenders`             | `?from&to`                                                                 | 200 `LenderMetrics`                                                                                                                                                 |
| GET    | `/api/backoffice/metrics/abuse`               | `?from&to`                                                                 | 200 `AbuseMetrics`                                                                                                                                                  |
| PUT    | `/api/backoffice/lenders/:lender/switch`      | `:lender` ∈ `alfa\|beta\|gama\|delta` (lower case); `{ enabled: boolean }` | 200 `LenderState`. **Every call appends a switch-log row, even if nothing changed.**                                                                                |
| GET    | `/api/backoffice/lenders/switch-log`          | list query                                                                 | 200 `ListResponse<SwitchLogItem>`                                                                                                                                   |
| GET    | `/api/backoffice/consultations`               | list query                                                                 | 200 `ListResponse<ConsultationListItem>` (no CPF)                                                                                                                   |
| POST   | `/api/backoffice/consultations/search-by-cpf` | `{ cpf, …list query keys }` in the body                                    | 200 `ListResponse<ConsultationListItem>`                                                                                                                            |
| GET    | `/api/backoffice/consultations/:id`           | none                                                                       | 200 `ConsultationDetail` (**decrypted CPF**). A non-UUID or unknown id → 404 `CONSULTATION_NOT_FOUND`.                                                              |
| GET    | `/api/backoffice/throttle-events`             | list query                                                                 | 200 `ListResponse<ThrottleEventItem>`                                                                                                                               |

### 3.4 Lender simulator (public, unauthenticated, always mounted)

`POST /api/simulator/lenders/alfa/pre-approvals`, `…/beta/v2/quotes`, `…/gama/analises`, `…/delta/credit-check`. These are the simulated lenders the worker calls (`LENDER_BASE_URL`). They're reachable by anyone, **whatever `SIMULATION_CONTROLS` says**, and they honour the scenario field in their own body. They create no consultations and touch no data, but they sleep for the simulated latency. They aren't part of the consumer contract; shapes are in `.ef/pre-approval-journey/contract/api.md` § Lender simulator, with D9 above.

Any other `/api/*` path or method → 404 `NOT_FOUND` (except `OPTIONS`, D7).

---

## 4. Request and response shapes

Wire types: money = JSON integer cents (≤ 2⁵³). Ids = UUID strings (UUIDv7). Timestamps = ISO-8601 UTC with milliseconds (`"2026-10-28T13:43:00.334Z"`). Dates = `"YYYY-MM-DD"`. Rates = 6-decimal fraction strings.

### 4.1 `POST /api/consultations`

Header `Idempotency-Key`: required, a UUID in either letter case (pattern `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`). The server lower-cases it before storing and comparing, so one UUID is one key whatever its case. Missing or malformed → 422, `fields[0] = { path: "idempotency-key", message: "Idempotency-Key inválida" }`. This header error appears only once the body is valid (D8).

| Field                  | Type    | Required | Rule (server)                                                                                                                                                                                                                                                                                                                                                                                                                | Field message                                                                                                                                                                                                                 |
| ---------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fullName`             | string  | yes      | trimmed, 3–120 chars, ≥ 2 words                                                                                                                                                                                                                                                                                                                                                                                              | `Informe nome e sobrenome`                                                                                                                                                                                                    |
| `cpf`                  | string  | yes      | `00000000000` or `000.000.000-00` (dots and dash each optional); valid check digits; not all one digit                                                                                                                                                                                                                                                                                                                       | `CPF inválido`                                                                                                                                                                                                                |
| `birthdate`            | string  | yes      | `YYYY-MM-DD`, a real date, age 18–80 on the server's date                                                                                                                                                                                                                                                                                                                                                                    | `A idade deve estar entre 18 e 80 anos` (also for bad format)                                                                                                                                                                 |
| `phone`                | string  | yes      | Brazilian mobile: DDD from the national list + `9` + 8 digits (11 national digits); `+55`/`55`/`0` prefixes dropped; only digits, spaces and `()+.-` (`src/lib/phone/phone.ts`)                                                                                                                                                                                                                                              | `Informe o celular com DDD, ex.: (11) 98765-4321` (malformed, wrong length, other country) · `DDD inválido` · `Informe um celular; telefone fixo não é aceito` · `O celular deve ter 9 dígitos começando com 9 depois do DDD` |
| `email`                | string  | no       | trimmed: one `@`; local part ≤ 64 chars from the WHATWG `type=email` set, no leading/trailing/double dot; domain labels of letters, digits and inner hyphens, ≥ 2 labels, last one a 2–63-letter TLD; ≤ 254 chars in all (`src/lib/email/email.ts`). Stored trimmed and lower-cased on the patient (latest submission wins, absent clears it); never in a public payload. `""` and `null` are rejected: omit the key instead | `Informe um e-mail válido, ex.: nome@exemplo.com` · `Valor inválido` (null)                                                                                                                                                   |
| `address`              | object  | yes      | `{ cep, street, number, complement?, neighborhood, city, state }`, see the table below. Stored normalised on the patient (latest submission wins), never in a public payload                                                                                                                                                                                                                                                 | per field, below; a missing object → `address` / `Campo obrigatório`                                                                                                                                                          |
| `monthlyIncomeCents`   | integer | yes      | 0 ≤ n ≤ 2⁵³−1                                                                                                                                                                                                                                                                                                                                                                                                                | `Informe a renda mensal` (plus generic bound messages)                                                                                                                                                                        |
| `treatmentAmountCents` | integer | yes      | 100 000 ≤ n ≤ 5 000 000 (R$ 1.000,00 – R$ 50.000,00)                                                                                                                                                                                                                                                                                                                                                                         | `O valor deve estar entre R$ 1.000,00 e R$ 50.000,00` (plus generic)                                                                                                                                                          |
| `simulationScenario`   | enum    | no       | `NORMAL` \| `ALL_APPROVE` \| `DELTA_FAILS` \| `DELTA_TIMES_OUT` \| `NONE_APPROVE`. Absent ≡ `NORMAL`; `null` is rejected; non-`NORMAL` needs `SIMULATION_CONTROLS=true`                                                                                                                                                                                                                                                      | `Opção inválida`                                                                                                                                                                                                              |

`address` fields (`src/lib/address/address.ts`):

| Field          | Type   | Required | Rule                                                                                                              | Field message                                                    |
| -------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `cep`          | string | yes      | `00000000` or `00000-000`, not starting with `00000`; surrounding spaces ignored; stored as 8 digits              | `CEP inválido`                                                   |
| `street`       | string | yes      | not blank, ≤ 120 chars before trimming; stored trimmed                                                            | `Informe a rua` (blank) · `Deve ter no máximo 120 caracteres`    |
| `number`       | string | yes      | not blank, ≤ 10 chars before trimming, free text (`123`, `123A`, `S/N`); stored trimmed                           | `Informe o número (ou S/N)` · `Deve ter no máximo 10 caracteres` |
| `complement`   | string | no       | ≤ 60 chars before trimming (a long whitespace-only value is rejected too); `null` rejected; blank dropped         | `Valor inválido` (null) · `Deve ter no máximo 60 caracteres`     |
| `neighborhood` | string | yes      | not blank, ≤ 80 chars before trimming; stored trimmed                                                             | `Informe o bairro` · `Deve ter no máximo 80 caracteres`          |
| `city`         | string | yes      | not blank, ≤ 80 chars before trimming; stored trimmed                                                             | `Informe a cidade` · `Deve ter no máximo 80 caracteres`          |
| `state`        | enum   | yes      | one of the 27 UFs, upper case: `AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO` | `Selecione a UF` (also when missing)                             |

A missing `fullName`, `cpf`, `birthdate`, `phone` or `address` → `Campo obrigatório`, and so does a missing `address.cep`, `street`, `number`, `neighborhood` or `city`. A missing `monthlyIncomeCents`, `treatmentAmountCents` or `address.state` → its own message (`Informe a renda mensal`, `O valor deve estar entre R$ 1.000,00 e R$ 50.000,00`, `Selecione a UF`).

A `null` or non-string value for any address field (`"street": null`, `"cep": 1310100`), or `"address": null` itself, → `Valor inválido` at that path. Observed: `"street": " " + 120 chars` → `address.street` / `Deve ter no máximo 120 caracteres`; `"street": null` → `address.street` / `Valor inválido`; `"address": null` → `address` / `Valor inválido`; `"cep": " 01310-100 "` → 202.

Response `202 { "id": string }`: the same `id` on a replay.

### 4.1.1 `GET /api/addresses/:cep`

`:cep` is masked or bare (`01310-100`, `01310100`), with surrounding spaces ignored (observed: `/api/addresses/%2001310100` → 200). Anything else, or a CEP starting with `00000` → 422 `fields: [{ "path": "cep", "message": "CEP inválido" }]`, whatever the request's `Content-Type`.

`AddressLookup` (200):

| Field          | Wire type | Notes              |
| -------------- | --------- | ------------------ |
| `cep`          | string    | 8 digits, unmasked |
| `street`       | string    | may be `""`        |
| `neighborhood` | string    | may be `""`        |
| `city`         | string    | never empty        |
| `state`        | enum      | one of the 27 UFs  |

There's no `number` or `complement`: those are always the user's. Upstream mapping (`viacep.adapter.ts`), with `GET {VIACEP_BASE_URL}/ws/<8 digits>/json/` bounded by `VIACEP_TIMEOUT_MS` (defaults `https://viacep.com.br`, 3 000 ms):

- a known CEP → 200
- ViaCEP's `{"erro": true}` (or `"true"`) or its HTTP 400 → 404 `CEP_NOT_FOUND`
- any other status, a network failure, the timeout, or a body that isn't the expected JSON → 503 `ADDRESS_LOOKUP_UNAVAILABLE`

Cache, per app process, LRU of 1 000 CEPs keyed by the 8 digits: found 24 h, not found 1 h, unavailable never. Observed through Caddy: an uncached `01310100` took ≈ 1.2 s.

### 4.2 `ConsultationPublicView`

Returned by GET, choice and every SSE `snapshot`. All keys are always present.

| Field                  | Wire type                                                                   | Notes                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | string (UUID)                                                               |                                                                                                                                                         |
| `journeyStatus`        | `"QUOTING"` \| `"OFFERS"` \| `"NO_OFFER"` \| `"CHOSEN"`                     | Derived: `CHOSEN` if `choice` ≠ null; else `OFFERS` if `offers` ≠ []; else `NO_OFFER` if `SETTLED`; else `QUOTING`                                      |
| `quoteStatus`          | `"QUOTING"` \| `"SETTLED"`                                                  | `SETTLED` once no attempt is `PENDING`; at the latest at `deadlineAt` (worker finalizer, or lazily on the next read)                                    |
| `createdAt`            | ISO timestamp                                                               |                                                                                                                                                         |
| `deadlineAt`           | ISO timestamp                                                               | `createdAt + CONSULTATION_DEADLINE_MS`                                                                                                                  |
| `settledAt`            | ISO timestamp \| `null`                                                     | `null` while `QUOTING`                                                                                                                                  |
| `patientFirstName`     | string                                                                      | First word of the patient's current name (D11). The only identity field: no CPF, birthdate, phone or income anywhere in public payloads                 |
| `treatmentAmountCents` | integer                                                                     | Frozen requested amount                                                                                                                                 |
| `simulationScenario`   | enum (§ 4.1)                                                                | Always present, `"NORMAL"` when none was sent                                                                                                           |
| `attempts`             | array of exactly 4, ordered ALFA, BETA, GAMA, DELTA                         | See below                                                                                                                                               |
| `offers`               | array, `[]` until some lender approves; ordered by lender then `termMonths` | See below                                                                                                                                               |
| `choice`               | `{ "offerId": string, "chosenAt": ISO }` \| `null`                          | Set once, never changes                                                                                                                                 |
| `suggestion`           | `{ "treatmentAmountCents": integer }` \| `null`                             | Non-null only when `journeyStatus = "NO_OFFER"` and some `REFUSED` attempt carried a hint ≥ 100 000 and < `treatmentAmountCents`; the highest such hint |

Attempt:

| Field           | Wire type                                                     | Present as non-null when                                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lender`        | `"ALFA"` \| `"BETA"` \| `"GAMA"` \| `"DELTA"`                 | always                                                                                                                                                                                                                                                    |
| `status`        | `"PENDING"` \| `"APPROVED"` \| `"REFUSED"` \| `"UNAVAILABLE"` | always; `PENDING` → exactly one terminal value, never changes again                                                                                                                                                                                       |
| `reason`        | enum \| `null`                                                | `REFUSED` → `AMOUNT_ABOVE_LIMIT` \| `PROFILE_NOT_ELIGIBLE`; `UNAVAILABLE` → `LENDER_ERROR` (lender 5xx) \| `TIMEOUT` \| `CIRCUIT_OPEN` \| `DISABLED` (kill switch) \| `INTEGRATION_ERROR` (unreachable, 4xx, unreadable). `null` for `PENDING`/`APPROVED` |
| `approvedCents` | integer \| `null`                                             | `APPROVED` only                                                                                                                                                                                                                                           |
| `monthlyRate`   | string \| `null`                                              | `APPROVED` only                                                                                                                                                                                                                                           |
| `settledAt`     | ISO \| `null`                                                 | terminal statuses                                                                                                                                                                                                                                         |

Offer: one per approving lender **and** term. Offers are immutable: written when the attempt settles, never updated or deleted.

| Field                    | Wire type     | Notes                                                |
| ------------------------ | ------------- | ---------------------------------------------------- |
| `id`                     | string (UUID) | What you send to `…/choice`                          |
| `lender`                 | enum          |                                                      |
| `approvedCents`          | integer       | Principal of the installment calculation             |
| `requestedCents`         | integer       | The consultation's amount                            |
| `approvedBelowRequested` | boolean       | `approvedCents < requestedCents` (Beta always: 60 %) |
| `monthlyRate`            | string        | e.g. `"0.024900"`                                    |
| `termMonths`             | integer       |                                                      |
| `installmentCents`       | integer       | Tabela Price, exact, rounded half-up to the cent     |
| `totalCents`             | integer       | Exactly `installmentCents × termMonths`              |

Lender terms as simulated (`NORMAL`): Alfa 2.49 % a.m., terms 6/12/18, approves 100 % if income × 10 ≥ amount, else refuses with hint income × 10. Beta 1.99 %, terms 12/18/24, always approves 60 % (half-up). Gama 3.29 %, terms 6/10/12, refuses age < 25 (no hint) or amount > R$ 20.000 (hint 2 000 000), else approves 100 %. Delta 2.19 %, terms 12/24/36, HTTP 500 ≈ 30 %, else approves 100 %, latency 4–15 s, so it often times out. Terms come from each lender's answer, not from a static list. The Delta failure share is `SIMULATOR_DELTA_FAILURE_RATE` (default 0.3). Every latency is multiplied by `SIMULATOR_TIME_SCALE` (default 1, range (0, 1]).

### 4.3 `GET /api/consultations/:id/events` (SSE)

Response headers: `content-type: text/event-stream`, `cache-control: no-cache`. Frames (Elysia `sse()`), with no `id:` or `retry:` lines:

```
event: snapshot
data: {…ConsultationPublicView on one line…}

event: ping
data: null

```

- The first frame is always a full `snapshot`, sent right after the server subscribes to updates, so nothing committed after the subscription is missed.
- A further `snapshot` is sent only when the view changed (a lender settled, a choice was made, the deadline passed).
- `ping` is sent only after 15 s without a snapshot (D3).
- The server closes the stream right after the first snapshot whose `quoteStatus` is `"SETTLED"`.
- There's no `Last-Event-ID` and no replay. After a drop, reconnect: the first frame is again a complete snapshot (RF-208).
- An error before the first frame (unknown id) is an ordinary problem+json response with its status. A failure mid-stream just ends the stream [INFERENCE: no error frame is emitted by the code].

### 4.4 `POST /api/consultations/:id/choice`

Body `{ "offerId": "<uuid>" }`. A non-UUID → 422 `fields: [{ path: "offerId", message: "Oferta inválida" }]`. Either letter case is accepted: the server lower-cases `offerId` before matching, and an upper-case copy of an offer id chooses that offer. Response 200 `ConsultationPublicView` with `journeyStatus: "CHOSEN"`. Allowed while `QUOTING` and after `SETTLED`; offers never expire.

### 4.5 `POST /api/consultations/:id/requote`

Header `Idempotency-Key` (UUID in either case, lower-cased by the server; its own key, separate from the create's). Body:

| Field                  | Type    | Required | Rule                                                              |
| ---------------------- | ------- | -------- | ----------------------------------------------------------------- |
| `treatmentAmountCents` | integer | yes      | 100 000–5 000 000 **and** < the source's amount                   |
| `simulationScenario`   | enum    | no       | Absent ≡ `NORMAL` (it does **not** inherit the source's scenario) |

Response `202 { "id": "<new consultation id>" }`. The new consultation belongs to the source's patient. It copies the source's frozen `monthlyIncomeCents` and `birthdate` (age recomputed today), and gets four new lender attempts. It isn't linked to the source in any payload.

### 4.6 Backoffice shapes

`POST /session` body: `username` (string, 1–100, `Informe o usuário`), `password` (string, 1–200, `Informe a senha`). Wrong credentials → 401 `INVALID_CREDENTIALS`.

**List query** (query string, or body keys for search-by-cpf):

| Key        | Type                             | Default      | Rule                                                                                                                          |
| ---------- | -------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `page`     | integer ≥ 1                      | 1            |                                                                                                                               |
| `pageSize` | integer 1–100                    | 20           |                                                                                                                               |
| `sort`     | `"<field>:asc\|desc"`            | per endpoint | field from the endpoint's allow-list; the id is always appended as tiebreaker                                                 |
| `q`        | string ≤ 100                     | none         | case-insensitive substring over the searchable columns                                                                        |
| filters    | top-level keys, string \| number | none         | `<field>` = equality; `<field>From` / `<field>To` = inclusive range. Empty values are ignored. Any key not allow-listed → 422 |

| Endpoint                     | Equality filters                                                                   | Range filters (`…From`/`…To`)                       | Sorts                                                      | `q` over                           | Default sort     |
| ---------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------- | ---------------- |
| consultations, search-by-cpf | `status` (journey status), `quoteStatus`, `simulationScenario`, `patientId` (UUID) | `createdAt` (ISO), `treatmentAmountCents` (integer) | `createdAt`, `treatmentAmountCents`, `settledAt`, `status` | patient full name, consultation id | `createdAt:desc` |
| switch-log                   | `lender` (`ALFA`…), `enabled` (`true`/`false`), `actor`                            | `createdAt`                                         | `createdAt`, `lender`                                      | `actor`                            | `createdAt:desc` |
| throttle-events              | `route`, `statusCode`, `errorCode` (`[A-Z_]{1,40}`), `ipHash` (8 hex)              | `createdAt`                                         | `createdAt`, `statusCode`                                  | `errorCode`, `route`               | `createdAt:desc` |

`ListResponse<T>` = `{ items: T[], page, pageSize, total, totalPages }` (integers; `totalPages = ceil(total / pageSize)`, `0` when empty).

- `ConsultationListItem`: `id`, `status` (journey status), `quoteStatus`, `treatmentAmountCents`, `simulationScenario`, `patientId`, `patientName` (full name), `createdAt`, `settledAt` (ISO \| null).
- `search-by-cpf` body: `cpf` (formatted or bare; exact match through the blind index; a partial CPF → 422 `CPF inválido`, never a prefix search), plus any list-query key. Extra keys must be strings or numbers.
- `ConsultationDetail`: `id`, `status`, `quoteStatus`, `simulationScenario`, `createdAt`, `deadlineAt`, `settledAt`. Then `patient { id, cpf (11 digits, unmasked), fullName, birthdate (YYYY-MM-DD), phone (digits only), email, address, createdAt, updatedAt }`. `email` is a string (trimmed, lower-cased) or **`null`** when the patient's latest submission had none (observed: `"  Ana.Lima@Exemplo.COM "` on create → `"email":"ana.lima@exemplo.com"`, then `null` after a resubmission without it). `address` is `{ cep (8 digits), street, number, complement (string \| null), neighborhood, city, state }`, the latest address sent, or **`null`** for a patient saved before addresses existed (`backoffice.dto.ts:415-438`: null unless every required column is set). Both cases were observed. A create with no complement and `"cep":" 01310-100 "` → `"address":{"cep":"01310100","street":"Avenida Paulista","number":"1578","complement":null,"neighborhood":"Bela Vista","city":"São Paulo","state":"SP"}`; the pre-address patient of § 9.4 → `"address":null`. Then `inputs { monthlyIncomeCents, treatmentAmountCents, birthdate, ageYears }` and `choice` (same shape as public). Each attempt has `id`, `lender`, `status`, `reason`, `approvedCents`, `monthlyRate`, `maxApprovableCents` (the refusal hint), `breakerProbe`, `createdAt`, `pickedAt`, `calledAt`, `settledAt`, `latencyMs` (nullable except `id`, `lender`, `status`, `breakerProbe`, `createdAt`), plus the undeclared `consultationId`, `simulationScenario`. Each offer has `id`, `lender`, `approvedCents`, `requestedCents`, `monthlyRate`, `termMonths`, `installmentCents`, `totalCents`, `createdAt`, plus the undeclared `attemptId`, `consultationId`. There's **no** `approvedBelowRequested` here.
- `LenderState`: `{ lender: "ALFA"|"BETA"|"GAMA"|"DELTA" (the upper-case code of :lender), enabled: boolean, updatedAt: ISO }`. `SwitchLogItem`: `{ id, lender, enabled, actor, createdAt }`.
- `ThrottleEventItem`: `{ id, route: "consultation.create"|"consultation.requote"|"address.lookup", ipHash (8 hex of the IP HMAC), statusCode: int|null, errorCode: string|null, createdAt }`. `statusCode`/`errorCode` are `null` until the response is written (or if writing the outcome failed). The `route` filter accepts the same three values.

**Metrics range**: `from` inclusive, `to` exclusive, each any `Date`-parseable string ≤ 40 chars. Defaults: `to` = now and `from` = `to` − 24 h. Unparseable → 422 `Período inválido.` with `{ path, message: "Informe uma data e hora ISO-8601" }`. `from ≥ to` → `{ path: "from", message: "O início deve ser anterior ao fim" }`.

- `PipelineMetrics`: `{ from, to, bucket, series[], totals, chosenByLender[] }`. `bucket` defaults to `"hour"`. `series` = every UTC bucket overlapping `[from, to)`, zero-filled, each `{ bucketStart, consultations, requestedCents, approvedCents, chosenCents }`; the first `bucketStart` may precede `from`. More than 1 000 buckets → 422 `{ path: "bucket", message: "O período tem mais de 1000 intervalos" }`. `totals` = `{ consultations, requestedCents, approvedCents, chosenCents, settledConsultations, approvedConsultations, approvalRate, approvedRequestedRatio, chosenOffers, avgChosenInstallmentCents, avgChosenTotalCents }`, where the two ratios (0–1) are `null` when nothing settled and the averages are `null` when nothing was chosen. `chosenByLender` always has the 4 lenders: `{ lender, chosenOffers, chosenCents }`.
- `LenderMetrics`: `{ from, to, lenders[4] }`, each `{ lender, enabled, breaker: "CLOSED"|"OPEN"|"HALF_OPEN", queueBacklog, settledAttempts, calledAttempts, p50LatencyMs, p95LatencyMs (number|null, may be fractional), approved, refused, errors, timeouts, approvalRate, refusalRate, errorRate, timeoutRate (0–1|null) }`. `breaker`, `enabled` and `queueBacklog` are live state, not range-bound. The backlog can lag up to 60 s (RFC O7). The rates include forced-scenario attempts (RFC O8).
- `AbuseMetrics`: `{ from, to, requests, limitHits: { IP_LIMIT, PATIENT_LIMIT }, tooManyRequests, topPatients[≤10] { patientId, firstName, consultations }, topIps[≤10] { ipHash, requests, tooManyRequests } }`. The request, limit-hit and 429 counts cover create and requote only; CEP lookups (one or more per signup) are excluded and appear only in `GET /api/backoffice/throttle-events` (`route: "address.lookup"`).

---

## 5. Error contract

Every error the app produces is RFC 9457 `application/problem+json`:

```ts
{ type: `urn:parcela:error:${code.toLowerCase()}`, title: string, status: number, code: ErrorCode, detail?: string, fields?: { path: string; message: string }[] }
```

`detail` is **absent** (not `""`, not `null`) for `NOT_FOUND` and `INTERNAL`. `fields` is present only on request-schema, list-query and metrics-range validation failures.

| `code`                       | Status | `title` (literal)                                 | `detail` (literal)                                                                                                                                                                                                                                                                           | `fields`                                             |
| ---------------------------- | ------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `VALIDATION`                 | 422    | `Dados inválidos`                                 | `Verifique os campos destacados.` (schema) · `O corpo da requisição não é um JSON válido.` (malformed JSON) · `Envie o corpo como JSON (Content-Type: application/json).` (non-JSON content type) · `Parâmetros de lista inválidos.` (list allow-list) · `Período inválido.` (metrics range) | yes, except malformed JSON and non-JSON content type |
| `IDEMPOTENCY_KEY_REUSED`     | 422    | `Chave de idempotência já usada com outros dados` | `Esta chave de idempotência já foi usada com outros dados.`                                                                                                                                                                                                                                  | no                                                   |
| `SIMULATION_DISABLED`        | 422    | `Cenários de simulação desativados`               | `Cenários de simulação estão desativados.`                                                                                                                                                                                                                                                   | no                                                   |
| `PATIENT_LIMIT`              | 429    | `Limite de consultas do paciente atingido`        | `Este paciente já fez {RATE_LIMIT_PATIENT_MAX} consultas nas últimas {RATE_LIMIT_PATIENT_WINDOW_HOURS} horas. Tente novamente mais tarde.`                                                                                                                                                   | no                                                   |
| `IP_LIMIT`                   | 429    | `Muitas requisições`                              | `Muitas solicitações a partir deste endereço. Tente novamente mais tarde.`                                                                                                                                                                                                                   | no                                                   |
| `CONSULTATION_NOT_FOUND`     | 404    | `Consulta não encontrada`                         | `Consulta não encontrada.`                                                                                                                                                                                                                                                                   | no                                                   |
| `OFFER_NOT_FOUND`            | 404    | `Oferta não encontrada`                           | `Oferta não encontrada.` (also when the offer exists but belongs to another consultation)                                                                                                                                                                                                    | no                                                   |
| `CHOICE_CONFLICT`            | 409    | `Outra oferta já foi escolhida`                   | `Outra oferta já foi escolhida.`                                                                                                                                                                                                                                                             | no                                                   |
| `REQUOTE_NOT_ALLOWED`        | 409    | `Nova simulação não permitida`                    | `A consulta original ainda está em andamento.` · `A consulta original já tem uma pré-aprovação.` · `O novo valor deve ser menor que o da consulta original.`                                                                                                                                 | no                                                   |
| `CEP_NOT_FOUND`              | 404    | `CEP não encontrado`                              | `CEP não encontrado.`                                                                                                                                                                                                                                                                        | no                                                   |
| `ADDRESS_LOOKUP_UNAVAILABLE` | 503    | `Consulta de CEP indisponível`                    | `Não foi possível consultar o CEP agora. Preencha o endereço.`                                                                                                                                                                                                                               | no                                                   |
| `UNAUTHENTICATED`            | 401    | `Sessão inválida`                                 | `Sessão ausente, inválida ou expirada. Faça login novamente.`                                                                                                                                                                                                                                | no                                                   |
| `INVALID_CREDENTIALS`        | 401    | `Usuário ou senha inválidos`                      | `Usuário ou senha inválidos.`                                                                                                                                                                                                                                                                | no                                                   |
| `NOT_FOUND`                  | 404    | `Recurso não encontrado`                          | absent                                                                                                                                                                                                                                                                                       | no                                                   |
| `INTERNAL`                   | 500    | `Erro interno`                                    | absent                                                                                                                                                                                                                                                                                       | no                                                   |

The layers, in the order a request meets them:

1. **Route match.** No match → `NOT_FOUND`.
2. **Guards, before the body is read.** The per-IP throttle (create, requote, CEP lookup) → `IP_LIMIT`. The backoffice session → `UNAUTHENTICATED`. Either way the request is never validated.
3. **Body parse.**
   - Invalid JSON → `VALIDATION` without `fields`.
   - A request **with a body** (POST, PUT, PATCH, DELETE) whose content type Elysia doesn't parse into an object (e.g. `text/plain`) → `VALIDATION`, detail `Envie o corpo como JSON (Content-Type: application/json).`, without `fields`, on every body route. A GET/HEAD/OPTIONS ignores its `Content-Type` and keeps its field errors (`errors.plugin.ts:73-84`, `BODYLESS_METHODS`).
4. **Schema validation** → `VALIDATION` with `fields`. The body is validated first, then headers, params and query. Only the first part that fails is reported, so a missing `Idempotency-Key` surfaces only once the body is valid.
5. **Service rules**, which throw domain codes in a fixed order (§ 6).
6. **Anything unexpected** → `INTERNAL`, logged server-side as `http.unhandled_error`.

Machine-readable keys: `code` (and `type`) are stable; branch on them. `title`/`detail` are fixed pt-BR strings, safe to display. The only templated one is `PATIENT_LIMIT`, whose numbers come from env. `fields[].path` is stable; `fields[].message` isn't (D8).

Responses that are **not** problem+json: `OPTIONS` (SPA HTML, 200); the simulator's `500 {"error":"internal"}` and its empty `499`.

All field messages a consumer may see, beyond § 4.1: `Campo obrigatório`, `Valor inválido`, `Opção inválida`, `Formato inválido`, `Campo não permitido`, `Deve ser no mínimo N`, `Deve ser no máximo N`, `Deve ter pelo menos N caracteres`, `Deve ter no máximo N caracteres`. Also `Idempotency-Key inválida`, `Oferta inválida`, `Informe o usuário`, `Informe a senha` and `Credora desconhecida`. The e-mail adds `Informe um e-mail válido, ex.: nome@exemplo.com`. The address adds `CEP inválido` (also on the lookup's `cep`), `Informe a rua`, `Informe o número (ou S/N)`, `Informe o bairro`, `Informe a cidade` and `Selecione a UF`. In list queries, a bad `page`/`pageSize`/`q`, or a `sort` not shaped `field:asc|desc`, fails schema validation: detail `Verifique os campos destacados.`, with messages such as `Valor inválido`, `must be integer`, `Opção inválida`, `Deve ter no máximo 100 caracteres` and `Formato inválido`. Observed: `pageSize=500` and `page=0` each gave three entries (`Valor inválido`, `must be integer`, `Opção inválida`), a 101-char `q` gave `Deve ter no máximo 100 caracteres`, and `sort=cpf` gave `Formato inválido`. Detail `Parâmetros de lista inválidos.` covers only `Ordenação não permitida` (a well-formed sort on a field not on the allow-list), `Filtro não permitido` and `Valor de filtro inválido`. Metrics ranges add `Informe uma data e hora ISO-8601`, `O início deve ser anterior ao fim` and `O período tem mais de 1000 intervalos`. TypeBox's own English (e.g. `must be integer`) can appear for any string value, numeric or not, that fails an integer field: every failing integer in a query string or form body, and a JSON string in the body.

---

## 6. Business rules a consumer must respect

### 6.1 Capability-URL model

The consultation id (UUIDv7) is a bearer secret. Whoever holds it can read the consultation, stream it, choose an offer and requote; there's no session on public routes. Public payloads carry no CPF, birthdate, phone or income (RF-501/502), but they do carry amounts, offers, the first name and possibly an income-derived `suggestion` (O9). GET, SSE and choice aren't rate-limited.

### 6.2 Create: order of checks

1. IP throttle
2. Header/body validation
3. **Idempotency**: same key + same hash → replay (202, original id); same key + different hash → 422 `IDEMPOTENCY_KEY_REUSED`
4. Scenario gate: non-`NORMAL` while `SIMULATION_CONTROLS=false` → 422 `SIMULATION_DISABLED`
5. The patient is upserted by CPF, and its name/birthdate/phone/e-mail/address overwritten (an absent `email` sets it to `null`), then row-locked
6. Idempotency re-checked under the lock (a twin that just committed → replay, never a cap hit)
7. Patient cap → 429 `PATIENT_LIMIT`
8. Insert, with four `PENDING` attempts and their lender jobs plus the finalizer in the same transaction

Any rejection rolls back the whole transaction, including the patient upsert. On 202 every lender is still `PENDING` (RF-201).

### 6.3 Limits

| Limit              | Counts                                                                                                                                                                                                                                                                                                                                                                                                          | Env (default)                                                         | Answer                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------- |
| Per IP, per route  | Every request to `POST /api/consultations` (bucket `consultation.create`) or `POST /api/consultations/:id/requote` (bucket `consultation.requote`), whatever its outcome, 429s included. Rejected when the count in the window, **including this request**, exceeds the max: with the default, the 31st request in 60 min. The IP is the first `X-Forwarded-For` entry, else `"local"`. Stored only as an HMAC. | `RATE_LIMIT_IP_MAX` (30), `RATE_LIMIT_IP_WINDOW_MINUTES` (60)         | 429 `IP_LIMIT`, before validation |
| Per IP, CEP lookup | Every `GET /api/addresses/:cep` (bucket `address.lookup`), whatever its outcome: cache hits, 404s, 422s, 503s and the rejected 429s. Same rolling window and counting rule as above: with the default, the 121st lookup in 60 min.                                                                                                                                                                              | `RATE_LIMIT_LOOKUP_IP_MAX` (120), `RATE_LIMIT_IP_WINDOW_MINUTES` (60) | 429 `IP_LIMIT`, before validation |
| Per patient (CPF)  | Committed consultations of the patient created in the window: creates and requotes, any scenario. Replays and rejected attempts don't count. Rejected when the count is already ≥ max: with the default, the 6th.                                                                                                                                                                                               | `RATE_LIMIT_PATIENT_MAX` (5), `RATE_LIMIT_PATIENT_WINDOW_HOURS` (24)  | 429 `PATIENT_LIMIT`               |

Both windows are rolling, measured on the database clock. There's no `Retry-After`.

### 6.4 Lifecycle and timing

- **Settlement.** Each attempt settles exactly once. The consultation is `SETTLED` when the last attempt settles or at `deadlineAt`, whichever comes first. At the deadline, every still-`PENDING` attempt becomes `UNAVAILABLE` / `TIMEOUT`. A lender answer arriving later is discarded (RF-209/410). Each lender call is aborted at the remaining budget, and there are no retries.
- **Late reads finalize.** If the worker is late, any GET or SSE read past `deadlineAt` finalizes the consultation itself.
- **Kill switch and breaker.** A lender disabled by the kill switch settles `UNAVAILABLE` / `DISABLED` without a call, for any attempt picked after the switch. The circuit breaker (≥ 16 failures in the last 20 `NORMAL` calls within 5 min → `UNAVAILABLE` / `CIRCUIT_OPEN`; one probe after 30 s) governs `NORMAL` attempts only. Forced-scenario attempts bypass it but obey the kill switch.

### 6.5 Choice

The choice is checked and set under the consultation row lock:

1. Unknown consultation → 404 `CONSULTATION_NOT_FOUND`
2. Offer not in this consultation → 404 `OFFER_NOT_FOUND`
3. Same offer as the existing choice → 200 (no change, current view)
4. A different offer already chosen → 409 `CHOICE_CONFLICT`; the stored choice is unchanged

First choice wins. Choosing is allowed during `QUOTING` (RF-407) and after `SETTLED`. There's no un-choose.

### 6.6 Requote

The checks, in order:

1. IP throttle
2. Validation
3. Source exists (404)
4. Source `SETTLED` (409 `…ainda está em andamento.`)
5. Source has no `APPROVED` attempt (409 `…já tem uma pré-aprovação.`)
6. New amount < source amount (409 `O novo valor deve ser menor…`)
7. Idempotency (replay / 422)
8. Scenario gate
9. Patient cap (429)

In practice a requote is possible exactly when the source's `journeyStatus` is `NO_OFFER`. A non-null `suggestion` always passes check 6 and the minimum. A requote of a requote is allowed: the new consultation is an ordinary source.

### 6.7 Scenarios (`SIMULATION_CONTROLS=true` only)

| Scenario          | Behaviour                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NORMAL`          | Each lender's rule and latency (§ 4.2)                                                                                                                             |
| `ALL_APPROVE`     | All four approve. Delta answers in 4–8 s.                                                                                                                          |
| `DELTA_FAILS`     | Delta answers HTTP 500 in 4–8 s → `UNAVAILABLE` / `LENDER_ERROR`. The others follow their rules.                                                                   |
| `DELTA_TIMES_OUT` | Delta takes 12–15 s → `UNAVAILABLE` / `TIMEOUT` at the deadline                                                                                                    |
| `NONE_APPROVE`    | All four refuse: Alfa `AMOUNT_ABOVE_LIMIT` with hint ⌊amount / 2⌋; Beta, Gama and Delta `PROFILE_NOT_ELIGIBLE`. `suggestion` = ⌊amount / 2⌋ when that's ≥ 100 000. |

The scenario is stored on the consultation (`simulationScenario`) and echoed in every view. A requote resets it to `NORMAL` unless one is sent.

---

## 7. What is NOT implemented

These are accepted gaps; nothing behind them ships.

- **CORS.** No `Access-Control-*` headers, and `OPTIONS` is answered with HTML. A browser app on another origin can't call the API; native apps and server-to-server clients can.
- **Server-side session revocation** (D5). There's no per-user backoffice login: one operator from env (`BACKOFFICE_USERNAME`).
- **`Retry-After`** on 429.
- **SSE resume.** No `Last-Event-ID`, no `retry:`. The server sends no keep-alive inside the default deadline (D3).
- **Webhooks or callbacks** to clients. Updates arrive by SSE or polling only.
- **Public authentication, and rate limits on GET, SSE and choice.** The capability URL is the only gate (6.1).
- **HEAD/OPTIONS on `/api/*`** (D7). **OpenAPI / JSON Schema export.**
- **Offer expiry** (AD17). **Lender retries** (RFC D10). **Cancelling a consultation.** **Un-choosing.**
- **Retention or deletion of patient PII**: the PRD sets no period (`verification.md`).
- **Database health in `/api/health`**: it reports process liveness and the commit SHA only.
- **Address verification.** No CEP-to-address cross-check on submit, no ViaCEP call on create, and no address on the requote body (the requote reuses the patient). The lookup is a form helper only.
- **Journey stages 4–7** (proposal, analysis, signing, disbursement) **and any ledger** (PRD Non-goals, RFC D1).
- **Open product questions that affect consumers**: O5 (real client IP under rootless Podman, so RF-506 is only proven through Caddy on the verified stack), O6 (D2), O7/O8 (lender-health figures), O9 (income-derived suggestion), O10 (Delta's breaker trips on ordinary traffic ≈ 7 % of 20-call windows).

---

## 8. The consumer's responsibility alone

- **Idempotency keys.** Generate one UUID per logical submission: once per filled form, a new one per requote. Letter case doesn't matter (the server lower-cases it). Retry a timed-out or network-failed POST with the **same** key and byte-equivalent fields. Generate a **new** key whenever the user edits anything, or you'll get 422 `IDEMPOTENCY_KEY_REUSED`. Send bodies with `Content-Type: application/json`.
- **Client-side validation (RF-102/104/105).** Mirror § 4.1 (CPF check digits, age 18–80, R$ 1.000,00–50.000,00, name with surname, mobile phone with a real DDD, the optional e-mail's shape with a dotted domain, the address rules and the 27 UFs) and show the error on the field, in pt-BR. Send `email` only when the user typed one: an empty field must become an **absent** key, not `""` or `null`. The server stays authoritative.
- **Address entry.** Mirror the SPA's lookup flow:
  - Call `GET /api/addresses/:cep` once the CEP field holds 8 digits. Not on every keystroke: lookups share a 120-per-hour IP bucket.
  - On 200, prefill `street`, `neighborhood`, `city` and `state`. Keep `city` and `state` as the lookup returned them. Let the user fill `number` and `complement`, and type `street`/`neighborhood` when the lookup returns them empty.
  - On 404 `CEP_NOT_FOUND`, show the error on the CEP field. The SPA also keeps the address fields hidden and blocks "Próximo" until the CEP is known (RF-113), although the API would accept that CEP on create, since it has no cross-check.
  - On 503 `ADDRESS_LOOKUP_UNAVAILABLE`, 429 `IP_LIMIT` or a network failure, fall back to manual entry of every field and let the user submit; create doesn't depend on the lookup. The SPA treats every code other than `CEP_NOT_FOUND`/`VALIDATION` this way (`src/api/addresses.ts`).
  - Never call ViaCEP directly. The server's cache, timeout and per-IP cap are the integration.
  - Because the server doesn't cross-check CEP against city/UF on submit, any consistency between the CEP and the typed address is yours to keep (e.g. re-run the lookup when the CEP changes and don't let city/UF drift from it).
- **No PII in device storage (RF-107).** Hold signup data in memory only until submit. After submit, keep only the consultation id.
- **Keep the consultation id secret.** Don't send it to analytics or third-party logs, and share it only with the patient.
- **Live updates (RF-204/207/208).** Open the SSE stream, and reconnect with backoff until a snapshot has `quoteStatus: "SETTLED"`. Abort the request when the screen goes away. Replace your whole state with every snapshot. Polling `GET /api/consultations/:id` (e.g. every 1–2 s until `SETTLED`) is an acceptable fallback.
- **Status copy (RF-203, RF-301).** Map `PENDING` → "consultando", `APPROVED` → "aprovada", `REFUSED` → "recusada", `UNAVAILABLE` → "indisponível". Explain refusals only in non-sensitive terms: `AMOUNT_ABOVE_LIMIT` → amount above the lender's limit, `PROFILE_NOT_ELIGIBLE` → profile not eligible, any `UNAVAILABLE` reason → unavailable. **Never** show rule internals (income × 10, minimum age, R$ 20.000 cap).
- **Offers (RF-401–405).** Show the approved amount, rate (`"0.024900"` → "2,49 % a.m."), each term's installment and total, and flag `approvedBelowRequested` ("valor aprovado menor que o solicitado"). Sorting by lowest installment or lowest total is yours, over the server's integers. **Never compute money**; only format server values as pt-BR BRL.
- **Choice (RF-406/409).** Make choosing available as soon as an offer arrives. Show the confirmation from `choice.offerId`, including after a reload. On 409 `CHOICE_CONFLICT`, show the existing choice rather than retrying.
- **No-offer path (RF-302/303).** Show the `suggestion` ("tente R$ X") when present, and requote with exactly that amount or any lower valid one. The product owner hasn't decided whether showing an income-derived amount is acceptable (O9).
- **Back off on 429.** Every retry counts against the IP bucket.
- **Backoffice clients.** Keep the cookie jar scoped to `/api/backoffice` and use HTTPS when `APP_DOMAIN` is set. Never put a CPF in a URL: search goes in the POST body (RF-617, AD19). Treat `GET …/consultations/:id` as a PII-revealing call.
- **Accessibility (RF-809/810)** applies to any UI: keyboard operability, and announcing card state changes (e.g. `aria-live`).

---

## 9. Realistic examples

Captured on 2026-10-28: § 9.1 and 9.8 from the prod-parity stack (Caddy, `http://localhost:8080`); the § 9.1 e-mail replay and § 9.2 from the dev stack after the e-mail change; the rest from the dev stack earlier. The CPFs are randomly generated valid test numbers.

### 9.1 Create, then replay (the same 202, indistinguishable)

```http
POST /api/consultations
Idempotency-Key: 3125bbb5-09df-46ab-9db4-7750604cb075
Content-Type: application/json

{"fullName":"Renata Souza Prado","cpf":"626.807.892-61","birthdate":"1987-09-12","phone":"(11) 98765-4321","address":{"cep":"01310-100","street":"Avenida Paulista","number":"1578","complement":"Apto 42","neighborhood":"Bela Vista","city":"São Paulo","state":"SP"},"monthlyIncomeCents":800000,"treatmentAmountCents":1000000}
```

```http
HTTP/1.1 202 Accepted
Content-Type: application/json;charset=utf-8

{"id":"01a18345-a9ed-7053-b478-56660792ca33"}
```

The same key with `"cep":"01310100"`, `"street":"  Avenida Paulista "` and `"complement":" Apto 42 "` → **the same** `202 {"id":"01a18345-a9ed-7053-b478-56660792ca33"}`, because the hash is computed over normalised values. The same key with `"number":"1579"`:

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/problem+json

{"type":"urn:parcela:error:idempotency_key_reused","title":"Chave de idempotência já usada com outros dados","status":422,"code":"IDEMPOTENCY_KEY_REUSED","detail":"Esta chave de idempotência já foi usada com outros dados."}
```

`GET /api/consultations/01a18345-…` returned the usual 13 keys (`id` … `suggestion`). There's no `address` and no other patient data besides `patientFirstName: "Renata"`.

With the optional `email` (dev stack, key `cc2d8cd9-fef6-4ad5-abe8-f0c96be5d4a8`, CPF `909.425.831-59`):

```http
POST /api/consultations
Idempotency-Key: cc2d8cd9-fef6-4ad5-abe8-f0c96be5d4a8
Content-Type: application/json

{"fullName":"Ana Beatriz Lima","cpf":"909.425.831-59","birthdate":"1990-04-10","phone":"(11) 98765-2222","email":"  Ana.Lima@Exemplo.COM ","address":{"cep":"01310-100","street":"Avenida Paulista","number":"1578","neighborhood":"Bela Vista","city":"São Paulo","state":"SP"},"monthlyIncomeCents":800000,"treatmentAmountCents":1000000}
```

| Then, same key                   | Answer                                              |
| -------------------------------- | --------------------------------------------------- |
| (first request)                  | `202 {"id":"01a18394-a7bb-7f3f-b2a6-75ff9db98cf8"}` |
| `"email":"ana.lima@exemplo.com"` | `202` with the same id (normalised e-mail)          |
| no `email` key                   | `422 IDEMPOTENCY_KEY_REUSED`                        |

The public view had no e-mail anywhere. The backoffice detail showed `"email":"ana.lima@exemplo.com"`.

### 9.2 Validation: every bad field listed, `address.*` paths, duplicate paths, no `fields` for bad JSON

Body `{"fullName":"Mariana","cpf":"529.982.247-24","birthdate":"2010-01-01","phone":"123","email":"ana@clinica","address":{"cep":"1","street":"","number":"","neighborhood":"","city":"","state":"XX"},"monthlyIncomeCents":-1,"treatmentAmountCents":99999,"simulationScenario":"FOO"}`:

```json
{
  "type": "urn:parcela:error:validation",
  "title": "Dados inválidos",
  "status": 422,
  "code": "VALIDATION",
  "detail": "Verifique os campos destacados.",
  "fields": [
    { "path": "fullName", "message": "Informe nome e sobrenome" },
    { "path": "cpf", "message": "CPF inválido" },
    { "path": "birthdate", "message": "A idade deve estar entre 18 e 80 anos" },
    { "path": "phone", "message": "Informe o celular com DDD, ex.: (11) 98765-4321" },
    { "path": "email", "message": "Informe um e-mail válido, ex.: nome@exemplo.com" },
    { "path": "address.cep", "message": "CEP inválido" },
    { "path": "address.street", "message": "Informe a rua" },
    { "path": "address.number", "message": "Informe o número (ou S/N)" },
    { "path": "address.neighborhood", "message": "Informe o bairro" },
    { "path": "address.city", "message": "Informe a cidade" },
    { "path": "address.state", "message": "Selecione a UF" },
    { "path": "monthlyIncomeCents", "message": "Deve ser no mínimo 0" },
    { "path": "monthlyIncomeCents", "message": "Valor inválido" },
    { "path": "monthlyIncomeCents", "message": "Informe a renda mensal" },
    { "path": "treatmentAmountCents", "message": "Deve ser no mínimo 100000" },
    { "path": "treatmentAmountCents", "message": "Valor inválido" },
    {
      "path": "treatmentAmountCents",
      "message": "O valor deve estar entre R$ 1.000,00 e R$ 50.000,00"
    },
    { "path": "simulationScenario", "message": "Opção inválida" }
  ]
}
```

All 14 bad fields are there (18 entries). Before `maxErrors` was raised to 64, the list stopped at 8.

Other address answers, each with an otherwise valid body:

| `address` sent                                                                                                               | `fields`                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| absent                                                                                                                       | `[{"path":"address","message":"Campo obrigatório"}]`                                                                                                                                                                                                                                               |
| `{}`                                                                                                                         | `address.cep`, `.street`, `.number`, `.neighborhood`, `.city` → `Campo obrigatório`; `address.state` → `Selecione a UF`                                                                                                                                                                            |
| `{"cep":"00000-000","street":" ","number":"12345678901","complement":"<61 chars>","neighborhood":"","city":"","state":"sp"}` | `address.cep` `CEP inválido` · `address.street` `Informe a rua` · `address.number` `Deve ter no máximo 10 caracteres` · `address.complement` `Deve ter no máximo 60 caracteres` · `address.neighborhood` `Informe o bairro` · `address.city` `Informe a cidade` · `address.state` `Selecione a UF` |
| a valid address with `"complement":null`                                                                                     | `[{"path":"address.complement","message":"Valor inválido"}]`                                                                                                                                                                                                                                       |

E-mail answers, each with an otherwise valid body: `"email":"ana@clinica"` or `"email":""` → `[{"path":"email","message":"Informe um e-mail válido, ex.: nome@exemplo.com"}]`; `"email":null` → `[{"path":"email","message":"Valor inválido"}]`.

Missing header: `"fields":[{"path":"idempotency-key","message":"Idempotency-Key inválida"}]`. Malformed JSON:

```json
{
  "type": "urn:parcela:error:validation",
  "title": "Dados inválidos",
  "status": 422,
  "code": "VALIDATION",
  "detail": "O corpo da requisição não é um JSON válido."
}
```

### 9.3 SSE mid-quote: an offer chosen while three lenders are pending

`DELTA_TIMES_OUT`, R$ 10.000,00. The second frame (+1051 ms) brought Alfa's offers; the client chose the 6-month one, and the stream pushed this at +1081 ms:

```
event: snapshot
data: {"id":"01a182c2-831b-7abf-adad-64b8598a3347","journeyStatus":"CHOSEN","quoteStatus":"QUOTING", …}
```

The `data` line, pretty-printed:

```json
{
  "id": "01a182c2-831b-7abf-adad-64b8598a3347",
  "journeyStatus": "CHOSEN",
  "quoteStatus": "QUOTING",
  "createdAt": "2026-10-28T13:45:48.056Z",
  "deadlineAt": "2026-10-28T13:45:58.056Z",
  "settledAt": null,
  "patientFirstName": "Ana",
  "treatmentAmountCents": 1000000,
  "simulationScenario": "DELTA_TIMES_OUT",
  "attempts": [
    {
      "lender": "ALFA",
      "status": "APPROVED",
      "reason": null,
      "approvedCents": 1000000,
      "monthlyRate": "0.024900",
      "settledAt": "2026-10-28T13:45:48.816Z"
    },
    {
      "lender": "BETA",
      "status": "PENDING",
      "reason": null,
      "approvedCents": null,
      "monthlyRate": null,
      "settledAt": null
    },
    {
      "lender": "GAMA",
      "status": "PENDING",
      "reason": null,
      "approvedCents": null,
      "monthlyRate": null,
      "settledAt": null
    },
    {
      "lender": "DELTA",
      "status": "PENDING",
      "reason": null,
      "approvedCents": null,
      "monthlyRate": null,
      "settledAt": null
    }
  ],
  "offers": [
    {
      "id": "01a182c2-8610-7ef0-a244-024af98d841d",
      "lender": "ALFA",
      "approvedCents": 1000000,
      "requestedCents": 1000000,
      "approvedBelowRequested": false,
      "monthlyRate": "0.024900",
      "termMonths": 6,
      "installmentCents": 181489,
      "totalCents": 1088934
    },
    {
      "id": "01a182c2-8610-704d-aae0-7de07300dacf",
      "lender": "ALFA",
      "approvedCents": 1000000,
      "requestedCents": 1000000,
      "approvedBelowRequested": false,
      "monthlyRate": "0.024900",
      "termMonths": 12,
      "installmentCents": 97428,
      "totalCents": 1169136
    },
    {
      "id": "01a182c2-8610-74ec-9099-f92d73845172",
      "lender": "ALFA",
      "approvedCents": 1000000,
      "requestedCents": 1000000,
      "approvedBelowRequested": false,
      "monthlyRate": "0.024900",
      "termMonths": 18,
      "installmentCents": 69610,
      "totalCents": 1252980
    }
  ],
  "choice": {
    "offerId": "01a182c2-8610-7ef0-a244-024af98d841d",
    "chosenAt": "2026-10-28T13:45:49.131Z"
  },
  "suggestion": null
}
```

Things to notice:

- The offer ids aren't in term order.
- `CHOSEN` comes with `QUOTING`.
- The stream continued: Beta (`approvedCents: 600000`, `approvedBelowRequested: true`) and Gama arrived at +2604/+2608 ms, still `CHOSEN`.
- The last frame, at +10 826 ms, was `quoteStatus: "SETTLED"`, `settledAt: "2026-10-28T13:45:58.062Z"`, with Delta as `{"lender":"DELTA","status":"UNAVAILABLE","reason":"TIMEOUT","approvedCents":null,"monthlyRate":null,"settledAt":"2026-10-28T13:45:58.060Z"}`. Then EOF.
- The choice never changed.
- No `ping` frame was sent.

Re-choosing the same offer at +2.6 s (Alfa, Beta and Gama settled) returned 200 with **9** offers instead of 3: a different body from the first choose, with the same `choice` (D2).

### 9.4 No offer, with a suggestion, then requote

`NONE_APPROVE`, R$ 12.000,00. The final frame:

```json
{
  "id": "01a182c1-65ca-79c0-beec-6207260e4074",
  "journeyStatus": "NO_OFFER",
  "quoteStatus": "SETTLED",
  "createdAt": "2026-10-28T13:44:35.014Z",
  "deadlineAt": "2026-10-28T13:44:45.014Z",
  "settledAt": "2026-10-28T13:44:39.328Z",
  "patientFirstName": "João",
  "treatmentAmountCents": 1200000,
  "simulationScenario": "NONE_APPROVE",
  "attempts": [
    {
      "lender": "ALFA",
      "status": "REFUSED",
      "reason": "AMOUNT_ABOVE_LIMIT",
      "approvedCents": null,
      "monthlyRate": null,
      "settledAt": "2026-10-28T13:44:36.224Z"
    },
    {
      "lender": "BETA",
      "status": "REFUSED",
      "reason": "PROFILE_NOT_ELIGIBLE",
      "approvedCents": null,
      "monthlyRate": null,
      "settledAt": "2026-10-28T13:44:38.376Z"
    },
    {
      "lender": "GAMA",
      "status": "REFUSED",
      "reason": "PROFILE_NOT_ELIGIBLE",
      "approvedCents": null,
      "monthlyRate": null,
      "settledAt": "2026-10-28T13:44:36.582Z"
    },
    {
      "lender": "DELTA",
      "status": "REFUSED",
      "reason": "PROFILE_NOT_ELIGIBLE",
      "approvedCents": null,
      "monthlyRate": null,
      "settledAt": "2026-10-28T13:44:39.326Z"
    }
  ],
  "offers": [],
  "choice": null,
  "suggestion": { "treatmentAmountCents": 600000 }
}
```

The hint behind the suggestion (Alfa's `maxApprovableCents: 600000`) appears only in the backoffice detail.

Requote attempts against this consultation:

| Request                                        | Answer                                                                                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sent 0.3 s after create, while still `QUOTING` | `409 REQUOTE_NOT_ALLOWED` "A consulta original ainda está em andamento."                                                                                         |
| `{"treatmentAmountCents":1200000}`             | `409 REQUOTE_NOT_ALLOWED` "O novo valor deve ser menor que o da consulta original."                                                                              |
| `{"treatmentAmountCents":50000}`               | `422 VALIDATION`, three entries for `treatmentAmountCents`: `Deve ser no mínimo 100000`, `Valor inválido`, `O valor deve estar entre R$ 1.000,00 e R$ 50.000,00` |
| `{"treatmentAmountCents":600000}`, key K       | `202 {"id":"01a182c1-77d8-7c79-b83c-16f9c998cff9"}`: a new consultation, `simulationScenario: "NORMAL"`                                                          |
| the same, key K again                          | `202` with the same id                                                                                                                                           |
| `{"treatmentAmountCents":500000}`, key K       | `422 IDEMPOTENCY_KEY_REUSED`                                                                                                                                     |
| any requote of a consultation with an approval | `409 REQUOTE_NOT_ALLOWED` "A consulta original já tem uma pré-aprovação."                                                                                        |

### 9.5 Choice conflict and offer scoping

On a settled consultation with offers:

| Request                       | Answer                                                                 |
| ----------------------------- | ---------------------------------------------------------------------- |
| `{"offerId":"x"}`             | `422`, `fields: [{"path":"offerId","message":"Oferta inválida"}]`      |
| `{"offerId":"<random uuid>"}` | `404 {"…","code":"OFFER_NOT_FOUND","detail":"Oferta não encontrada."}` |
| Alfa 6 m offer                | `200`, view with `journeyStatus: "CHOSEN"`                             |
| the same offer again          | `200`, the same `choice`                                               |
| Beta 12 m offer               | `409` below                                                            |

```json
{
  "type": "urn:parcela:error:choice_conflict",
  "title": "Outra oferta já foi escolhida",
  "status": 409,
  "code": "CHOICE_CONFLICT",
  "detail": "Outra oferta já foi escolhida."
}
```

### 9.6 The two 429s

This was the 6th consultation for one CPF within 24 h: 1 create, 1 requote and 3 more creates were already committed. A replay of one of those earlier keys still returned `202`, and a requote for that patient got the same 429:

```json
{
  "type": "urn:parcela:error:patient_limit",
  "title": "Limite de consultas do paciente atingido",
  "status": 429,
  "code": "PATIENT_LIMIT",
  "detail": "Este paciente já fez 5 consultas nas últimas 24 horas. Tente novamente mais tarde."
}
```

The 31st request within an hour from one IP, after 30 **malformed** bodies (each answered 422, each counted). The response has no `Retry-After`:

```json
{
  "type": "urn:parcela:error:ip_limit",
  "title": "Muitas requisições",
  "status": 429,
  "code": "IP_LIMIT",
  "detail": "Muitas solicitações a partir deste endereço. Tente novamente mais tarde."
}
```

From the same IP, at the same moment, a requote with body `{}` got `422 VALIDATION` (separate bucket). A create with `X-Forwarded-For: <that IP>, 10.0.0.1` was still `429`, since only the first entry counts.

### 9.7 Backoffice session

```http
POST /api/backoffice/session
Content-Type: application/json

{"username":"operador","password":"senha-de-teste"}
```

```http
HTTP/1.1 204 No Content
Set-Cookie: bo_session=operador%7C1793223766.HuvzvSx6g6PEun9HGQWVFBZLwis6IBpuYzuLsUq7zGA; Max-Age=28800; Path=/api/backoffice; HttpOnly; SameSite=Lax
```

There's no `Secure` flag: the dev stack has no `APP_DOMAIN`. Without the cookie, or with a tampered or unsigned one, **even with an invalid body**:

```json
{
  "type": "urn:parcela:error:unauthenticated",
  "title": "Sessão inválida",
  "status": 401,
  "code": "UNAUTHENTICATED",
  "detail": "Sessão ausente, inválida ou expirada. Faça login novamente."
}
```

List allow-list violation (`GET /api/backoffice/consultations?sort=cpf:asc&cpf=1`):

```json
{
  "type": "urn:parcela:error:validation",
  "title": "Dados inválidos",
  "status": 422,
  "code": "VALIDATION",
  "detail": "Parâmetros de lista inválidos.",
  "fields": [
    { "path": "sort", "message": "Ordenação não permitida" },
    { "path": "cpf", "message": "Filtro não permitido" }
  ]
}
```

After `DELETE /api/backoffice/session` (204, expired cookie), replaying the **old** cookie on `GET /api/backoffice/session` still answered `200 {"username":"operador"}` (D5).

### 9.8 CEP lookup

Through Caddy (`http://localhost:8080`), real ViaCEP:

| Request                                 | Answer                                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/addresses/01310-100`          | `200 {"cep":"01310100","street":"Avenida Paulista","neighborhood":"Bela Vista","city":"São Paulo","state":"SP"}`; the same body for `/01310100`                                                        |
| `GET /api/addresses/69945000`           | `200 {"cep":"69945000","street":"","neighborhood":"","city":"Acrelândia","state":"AC"}`: a city-wide CEP with empty street and neighborhood                                                            |
| `GET /api/addresses/99999999`           | `404 {"type":"urn:parcela:error:cep_not_found","title":"CEP não encontrado","status":404,"code":"CEP_NOT_FOUND","detail":"CEP não encontrado."}`                                                       |
| `GET /api/addresses/12345`, `/00000000` | `422 {"type":"urn:parcela:error:validation","title":"Dados inválidos","status":422,"code":"VALIDATION","detail":"Verifique os campos destacados.","fields":[{"path":"cep","message":"CEP inválido"}]}` |

When ViaCEP fails (non-2xx other than 400, network error, `VIACEP_TIMEOUT_MS` exceeded, unexpected body), the answer is the following. It wasn't captured live (ViaCEP was up); this body is built from `address.service.ts:47-52`, `errors.plugin.ts` and `domain-error.ts`:

```json
{
  "type": "urn:parcela:error:address_lookup_unavailable",
  "title": "Consulta de CEP indisponível",
  "status": 503,
  "code": "ADDRESS_LOOKUP_UNAVAILABLE",
  "detail": "Não foi possível consultar o CEP agora. Preencha o endereço."
}
```

The client then lets the user type the whole address and submits normally (§ 8).
