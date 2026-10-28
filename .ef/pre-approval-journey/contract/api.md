# API

Root: `new Elysia({ prefix: "/api" })` in `src/server/app.ts`, mounted by `src/routes/api.$.ts` mapping **GET, POST, PUT, DELETE** to `({ request }) => app.fetch(request)`. Money is integer **cents** (`number`). Rates are decimal **strings** (`"0.024900"` = 2.49 % a.m.). Timestamps are ISO-8601 strings. The browser's Eden client is created with `treaty<App>(location.origin)`, with date parsing disabled if Eden exposes that option (verify; otherwise treat values as `string | Date`).

## Public

| Method & path                     | Request                                                                                                                                    | Success                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /consultations`             | header `Idempotency-Key` (uuid in either letter case, required; one UUID in any case is one key, amended 2026-10-28); body `SignupRequest` | **202** `{ id }` (replay with the same key and body → 202, same id)                                                                                                              |
| `GET /consultations/:id`          |                                                                                                                                            | 200 `ConsultationPublicView` (lazily finalizes past the deadline)                                                                                                                |
| `GET /consultations/:id/events`   |                                                                                                                                            | 200 `text/event-stream`: `snapshot` events (`ConsultationPublicView`), `ping` every 15 s; closes after the first snapshot whose `quoteStatus` is `SETTLED`                       |
| `POST /consultations/:id/choice`  | `{ offerId }` (uuid in either letter case)                                                                                                 | 200 `ConsultationPublicView`                                                                                                                                                     |
| `POST /consultations/:id/requote` | header `Idempotency-Key`; `{ treatmentAmountCents, simulationScenario? }`                                                                  | **202** `{ id }` (new consultation)                                                                                                                                              |
| `GET /config`                     |                                                                                                                                            | 200 `{ simulationControls: boolean }`                                                                                                                                            |
| `GET /health`                     |                                                                                                                                            | 200 `{ status: "ok", sha: string }` (`GIT_SHA`)                                                                                                                                  |
| `GET /addresses/:cep`             | `:cep` masked or bare (added 2026-10-28, RFC D27); throttle route `address.lookup`, cap `RATE_LIMIT_LOOKUP_IP_MAX`                         | 200 `AddressLookup { cep (8 digits), street, neighborhood, city, state }` (street/neighborhood may be `""`); 404 `CEP_NOT_FOUND`; 503 `ADDRESS_LOOKUP_UNAVAILABLE`; 422 at `cep` |

```ts
type SignupRequest = {
  fullName: string; // trimmed, 3–120 chars, at least two words
  cpf: string; // 11 digits after normalize; check digits (shared Cpf refine)
  birthdate: string; // YYYY-MM-DD; age 18–80 on the server date
  phone: string; // Brazilian mobile: DDD + 9 + 8 digits; +55/55/0 prefixes dropped (src/lib/phone, amended 2026-10-28)
  monthlyIncomeCents: number; // integer ≥ 0
  treatmentAmountCents: number; // integer 100000–5000000
  simulationScenario?: SimulationScenario; // ≠ NORMAL only if SIMULATION_CONTROLS
  address: {
    // required (added 2026-10-28, RFC D27; src/lib/address); 422 paths `address.<field>`; part of the idempotency hash
    cep: string; // 8 digits, masked or not, not 00000-xxx
    street: string; // non-blank, ≤ 120
    number: string; // non-blank free text (123, 123A, S/N), ≤ 10
    complement?: string; // ≤ 60; blank dropped
    neighborhood: string; // non-blank, ≤ 80
    city: string; // non-blank, ≤ 80
    state: BrState; // one of the 27 UFs
  };
};

type ConsultationPublicView = {
  id: string;
  journeyStatus: "QUOTING" | "OFFERS" | "NO_OFFER" | "CHOSEN"; // derived (consultation.dto.ts)
  quoteStatus: "QUOTING" | "SETTLED";
  createdAt: string;
  deadlineAt: string;
  settledAt: string | null;
  patientFirstName: string; // the ONLY identity field (no CPF digits, no mask)
  treatmentAmountCents: number;
  simulationScenario: SimulationScenario;
  attempts: Array<{
    // always 4, ordered ALFA, BETA, GAMA, DELTA
    lender: LenderCode;
    status: AttemptStatus;
    reason: AttemptReason | null;
    approvedCents: number | null;
    monthlyRate: string | null;
    settledAt: string | null;
  }>;
  offers: Array<{
    // ordered by lender, then termMonths
    id: string;
    lender: LenderCode;
    approvedCents: number;
    requestedCents: number;
    approvedBelowRequested: boolean;
    monthlyRate: string;
    termMonths: number;
    installmentCents: number;
    totalCents: number;
  }>;
  choice: { offerId: string; chosenAt: string } | null;
  suggestion: { treatmentAmountCents: number } | null; // only when journeyStatus = NO_OFFER and a hint < requested exists
};
```

`journeyStatus`: `CHOSEN` if a choice exists; else `OFFERS` if any offer exists; else `NO_OFFER` if `SETTLED`; else `QUOTING`.
`suggestion` = the max stored refusal hint (`lender_attempt.max_approvable_cents`) that's ≥ 100000 and < `treatmentAmountCents`; else null. The hints themselves never appear in public payloads (amended 2026-10-28, audit A1: Alfa's hint is income × 10, so exposing it leaked the income). Residual tension for the owner: in NORMAL, when Beta, Delta and Gama all fail to offer, the suggestion itself can equal income × 10 (RFC O9).
Offer sorting (lowest installment / lowest total) happens in the browser over these API values. The browser never computes money.

## Backoffice (`/backoffice/**`, prefixed plugin with the auth `derive` + `onBeforeHandle`)

| Method & path                                  | Request                                                                                                                            | Success                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /backoffice/session`                     | `{ username, password }`                                                                                                           | 204 + `Set-Cookie: bo_session` (httpOnly, SameSite=Lax, Max-Age 28800; `Secure` iff `APP_DOMAIN` is set, audit Q-3)                                                                                                                                               |
| `GET /backoffice/session`                      |                                                                                                                                    | 200 `{ username }`                                                                                                                                                                                                                                                |
| `DELETE /backoffice/session`                   |                                                                                                                                    | 204 + cookie removed                                                                                                                                                                                                                                              |
| `GET /backoffice/metrics/pipeline`             | `?from&to&bucket=day\|hour`                                                                                                        | 200 pipeline series + totals (RF-604/605)                                                                                                                                                                                                                         |
| `GET /backoffice/metrics/lenders`              | `?from&to`                                                                                                                         | 200 per-lender p50/p95, rates, `breaker: "CLOSED"\|"OPEN"\|"HALF_OPEN"`, `enabled`, `queueBacklog`                                                                                                                                                                |
| `GET /backoffice/metrics/abuse`                | `?from&to`                                                                                                                         | 200 limit hits, 429 counts, top CPF-patients (by id + first name, never CPF) and top IP hashes (first 8 hex)                                                                                                                                                      |
| `PUT /backoffice/lenders/:lender/switch`       | `{ enabled }`                                                                                                                      | 200 lender state; appends `lender_switch_log`                                                                                                                                                                                                                     |
| `GET /backoffice/lenders/switch-log`           | ListQuery                                                                                                                          | 200 ListResponse                                                                                                                                                                                                                                                  |
| `GET /backoffice/consultations`                | ListQuery                                                                                                                          | 200 ListResponse (no CPF, no decryption)                                                                                                                                                                                                                          |
| `GET /backoffice/consultations/:id`            |                                                                                                                                    | 200 detail: full patient incl. **decrypted CPF** and `address { cep, street, number, complement: string\|null, neighborhood, city, state } \| null` (null for patients saved before RFC D27), frozen inputs, attempts with timestamps and reasons, offers, choice |
| `POST /backoffice/consultations/search-by-cpf` | `{ cpf, …ListQuery }` (page, pageSize, sort, q and the consultations filter allow-list as body keys; amended 2026-10-28, audit A5) | 200 ListResponse (exact match via `cpf_hmac`); unknown sort/filter → 422                                                                                                                                                                                          |
| `GET /backoffice/throttle-events`              | ListQuery                                                                                                                          | 200 ListResponse                                                                                                                                                                                                                                                  |

Session cookie value = `"<username>|<expiresAtEpochSeconds>"`, signed by Elysia (`cookie: { secrets: BACKOFFICE_SESSION_SECRET, sign: ["bo_session"] }`). Missing, unsigned, tampered (`InvalidCookie` caught in `derive`) or expired → **401** `UNAUTHENTICATED`.

## List contract (every list endpoint and table)

Query: `page` (int ≥ 1, default 1) · `pageSize` (1–100, default 20) · `sort` (`<field>:asc|desc`, default per endpoint) · `q` (free-text over the endpoint's searchable fields) · per-field filters as **top-level params** from the endpoint's allow-list (equality, or `<field>From`/`<field>To` for ranges).
Response: `{ items, page, pageSize, total, totalPages }`.
Unknown sort/filter field → 422 `VALIDATION`. Every sort appends `id` as the tiebreaker. Each endpoint declares in code an allow-list `{ filters, sorts, search }` mapped to drizzle columns. The CPF is never in any allow-list.

## Errors (all `application/problem+json`, RFC 9457)

`{ type, title, status, code, detail?, fields? }`. Validation is mapped by the root `onError(ValidationError)` in **every** `NODE_ENV`: `422 { code: "VALIDATION", fields: [{ path: "patient.cpf", message: "<pt-BR>" }] }`.

| code                                         | status | when                                                                                                                                                            |
| -------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION`                                 | 422    | schema or refine failure; unknown list field; malformed JSON; a body content type without a JSON parser such as `text/plain` (Elysia's 415, amended 2026-10-28) |
| `IDEMPOTENCY_KEY_REUSED`                     | 422    | same key, different body hash                                                                                                                                   |
| `SIMULATION_DISABLED`                        | 422    | non-`NORMAL` scenario while `SIMULATION_CONTROLS=false`                                                                                                         |
| `PATIENT_LIMIT`                              | 429    | per-patient cap (create and requote)                                                                                                                            |
| `IP_LIMIT`                                   | 429    | per-IP guard                                                                                                                                                    |
| `CONSULTATION_NOT_FOUND` / `OFFER_NOT_FOUND` | 404    |                                                                                                                                                                 |
| `CEP_NOT_FOUND`                              | 404    | ViaCEP doesn't know the CEP (added 2026-10-28, RFC D27)                                                                                                         |
| `ADDRESS_LOOKUP_UNAVAILABLE`                 | 503    | ViaCEP failed, timed out or answered garbage; the form falls back to manual entry                                                                               |
| `CHOICE_CONFLICT`                            | 409    | a different offer is already chosen                                                                                                                             |
| `REQUOTE_NOT_ALLOWED`                        | 409    | source not `SETTLED`, has an approval, or amount not lower                                                                                                      |
| `UNAUTHENTICATED` / `INVALID_CREDENTIALS`    | 401    |                                                                                                                                                                 |
| `NOT_FOUND`                                  | 404    | no `/api` route matches (amended 2026-10-28, audit A8)                                                                                                          |
| `INTERNAL`                                   | 500    | unexpected error; logged as `http.unhandled_error`                                                                                                              |

## Lender simulator (`/simulator/lenders/*`, deliberately heterogeneous contracts)

| Lender                           | Request                                                           | Approve                                                                              | Refuse                                                                                  | Failure                     |
| -------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------- |
| Alfa `POST /alfa/pre-approvals`  | `{ cpf, renda_mensal, valor_solicitado, cenario }` (BRL decimals) | 200 `{ aprovado: true, valor_aprovado, taxa_mensal: "2.49", prazos: [6,12,18] }`     | 200 `{ aprovado: false, motivo: "RENDA_INSUFICIENTE", limite_maximo }`                  | —                           |
| Beta `POST /beta/v2/quotes`      | `{ document, requestedAmountCents, scenario }`                    | 201 `{ status: "APPROVED", maxAmountCents, rateBps: 199, terms: [12,18,24] }`        | 200 `{ status: "DECLINED", code: "POLICY" }` (`NONE_APPROVE` only)                      | —                           |
| Gama `POST /gama/analises`       | `{ paciente: { cpf, idade }, valorCentavos, cenario }`            | 200 `{ resultado: "APROVADO", valorCentavos, juros: 0.0329, parcelas: [6,10,12] }`   | 200 `{ resultado: "RECUSADO", regra: "IDADE_MINIMA" \| "VALOR_MAXIMO", tetoCentavos? }` | —                           |
| Delta `POST /delta/credit-check` | `{ taxId, amount, scenario }` (amount in cents)                   | 200 `{ decision: "accept", amount, monthlyRatePct: 2.19, installments: [12,24,36] }` | 200 `{ decision: "reject", reason: "risk" }` (`NONE_APPROVE` only)                      | 500 `{ error: "internal" }` |

Rules and latencies follow PDF p.2–3; scenario overrides are in `boundaries.md` § Scenarios. Adapters map these to `LenderResult` (`lender-port.md`).
