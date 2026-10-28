# Schema

Postgres (compose image `docker.io/library/postgres:18-alpine`; the code must also run on 17: no `uuidv7()` SQL default). drizzle-orm 1.0.0-rc.5, snake_case columns, one table per `*.table.ts`. Every relation lives in the sibling `*.relations.ts` of the table it **originates** from, built with `defineRelationsPart({ <only the referenced tables> }, r => …)`.

Relations-part rules (proven live):

- every relation declares explicit `from`/`to`, because reverse inference across parts throws at import time and breaks `drizzle-kit generate`;
- subset keys equal the barrel export names (`{ lenderAttempt }`, never aliased);
- `db/relations.ts` spreads `defineRelationsPart(schema)` first, then each part.

Column conventions: ids `uuid().primaryKey().$defaultFn(uuidv7)`; money `bigint({ mode: "number" })` in **cents**; rates `numeric({ precision: 7, scale: 6 })` (string, e.g. `"0.024900"`); timestamps `timestamp({ withTimezone: true })` (Date); calendar dates `date({ mode: "string" })` (`YYYY-MM-DD`); binary `bytea()` (Buffer).

## Enums (`pgEnum`, the single source; TS unions derive from them)

| Enum                  | Values                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lender_code`         | `ALFA` `BETA` `GAMA` `DELTA`                                                                                                                               |
| `simulation_scenario` | `NORMAL` `ALL_APPROVE` `DELTA_FAILS` `DELTA_TIMES_OUT` `NONE_APPROVE`                                                                                      |
| `quote_status`        | `QUOTING` `SETTLED`                                                                                                                                        |
| `attempt_status`      | `PENDING` `APPROVED` `REFUSED` `UNAVAILABLE`                                                                                                               |
| `attempt_reason`      | `AMOUNT_ABOVE_LIMIT` `PROFILE_NOT_ELIGIBLE` (with `REFUSED`) · `LENDER_ERROR` `TIMEOUT` `CIRCUIT_OPEN` `DISABLED` `INTEGRATION_ERROR` (with `UNAVAILABLE`) |

`INTEGRATION_ERROR` = the lender endpoint was unreachable or answered with an unmappable payload: distinguishable from a lender 500 (A19).

## Tables

### `patient` (`modules/patient/db/patient.table.ts`)

| Column                          | Type                                                                                            | Notes                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`                            | uuid pk                                                                                         | v7                                                                                                                        |
| `cpf_hmac`                      | bytea not null **unique**                                                                       | HMAC-SHA256(`PII_HMAC_KEY`, `"cpf:v1:" + 11 digits`)                                                                      |
| `cpf_ciphertext`                | bytea not null                                                                                  | `iv(12) ‖ ct(11) ‖ tag(16)`, AES-256-GCM, AAD = `cpf_hmac`                                                                |
| `cpf_key_version`               | smallint not null                                                                               |                                                                                                                           |
| `full_name`                     | text not null                                                                                   | trimmed                                                                                                                   |
| `birthdate`                     | date not null                                                                                   |                                                                                                                           |
| `phone`                         | text not null                                                                                   | the 11 national digits of a Brazilian mobile (`DDD` + `9` + 8), country/trunk prefix dropped (amended 2026-10-28)         |
| `email`                         | text null                                                                                       | trimmed, lower-cased (RFC D30, 2026-10-28); null when none was given; last write wins (a submission without it clears it) |
| `address_cep` … `address_state` | text null (7 columns: `cep`, `street`, `number`, `complement`, `neighborhood`, `city`, `state`) | normalised address (RFC D27, 2026-10-28); null for patients saved before addresses existed; `complement` null when absent |
| `created_at` / `updated_at`     | timestamptz not null default now()                                                              |                                                                                                                           |

Upsert: `ON CONFLICT (cpf_hmac) DO UPDATE SET full_name, birthdate, phone, email, address_*, updated_at`; never touches the ciphertext.

### `consultation` (`modules/consultation/db/consultation.table.ts`)

| Column                   | Type                                            | Notes                                                              |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------ |
| `id`                     | uuid pk                                         | v7; the capability URL id                                          |
| `patient_id`             | uuid not null → `patient.id`                    |                                                                    |
| `idempotency_key`        | text not null **unique**                        | client-generated (create and requote)                              |
| `request_hash`           | text not null                                   | sha256 hex of the canonical request body (+ source id for requote) |
| `monthly_income_cents`   | bigint(number) not null                         | frozen                                                             |
| `treatment_amount_cents` | bigint(number) not null                         | frozen; 100000–5000000                                             |
| `birthdate`              | date not null                                   | frozen                                                             |
| `age_years`              | smallint not null                               | frozen at submission; 18–80                                        |
| `simulation_scenario`    | `simulation_scenario` not null default `NORMAL` |                                                                    |
| `quote_status`           | `quote_status` not null default `QUOTING`       |                                                                    |
| `deadline_at`            | timestamptz not null                            | `created_at + CONSULTATION_DEADLINE_MS`                            |
| `settled_at`             | timestamptz null                                | set once with `SETTLED`                                            |
| `chosen_offer_id`        | uuid null → `offer.id`                          | set-once                                                           |
| `chosen_at`              | timestamptz null                                |                                                                    |
| `created_at`             | timestamptz not null default now()              |                                                                    |

Indexes: `(patient_id, created_at)` (patient cap), `(created_at, id)`, `(quote_status, deadline_at)`.

### `lender_attempt` (`modules/lender/db/lender-attempt.table.ts`)

| Column                 | Type                                        | Notes                                                                               |
| ---------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `id`                   | uuid pk                                     |                                                                                     |
| `consultation_id`      | uuid not null → `consultation.id`           | unique with `lender`                                                                |
| `lender`               | `lender_code` not null                      |                                                                                     |
| `simulation_scenario`  | `simulation_scenario` not null              | copied from the consultation; the breaker reads only `NORMAL`                       |
| `status`               | `attempt_status` not null default `PENDING` |                                                                                     |
| `reason`               | `attempt_reason` null                       | null iff `PENDING` or `APPROVED`                                                    |
| `approved_cents`       | bigint(number) null                         | set iff `APPROVED`                                                                  |
| `monthly_rate`         | numeric(7,6) null                           | set iff `APPROVED`                                                                  |
| `max_approvable_cents` | bigint(number) null                         | lender hint, refusals only                                                          |
| `breaker_probe`        | boolean not null default false              | the single half-open probe call                                                     |
| `created_at`           | timestamptz not null default now()          | job enqueued                                                                        |
| `picked_at`            | timestamptz null                            | worker took the job (pickup-latency metric, A8)                                     |
| `called_at`            | timestamptz null                            | outbound call started; null = skipped (`CIRCUIT_OPEN`, `DISABLED`, finalized first) |
| `settled_at`           | timestamptz null                            |                                                                                     |
| `latency_ms`           | integer null                                | `settled_at − called_at` for real calls                                             |

Indexes: unique `(consultation_id, lender)`; `(lender, simulation_scenario, settled_at desc)` (breaker window, lender health).

### `offer` (`modules/pricing/db/offer.table.ts`), immutable

| Column              | Type                                | Notes                               |
| ------------------- | ----------------------------------- | ----------------------------------- |
| `id`                | uuid pk                             |                                     |
| `attempt_id`        | uuid not null → `lender_attempt.id` | unique with `term_months`           |
| `consultation_id`   | uuid not null → `consultation.id`   | denormalized for reads              |
| `lender`            | `lender_code` not null              | denormalized                        |
| `approved_cents`    | bigint(number) not null             |                                     |
| `requested_cents`   | bigint(number) not null             | for the "approved < requested" flag |
| `monthly_rate`      | numeric(7,6) not null               |                                     |
| `term_months`       | smallint not null                   |                                     |
| `installment_cents` | bigint(number) not null             | from `price.ts`                     |
| `total_cents`       | bigint(number) not null             | `installment_cents × term_months`   |
| `created_at`        | timestamptz not null default now()  |                                     |

No UPDATE or DELETE path exists in `offer.repository.ts`.

### `lender_setting` (`modules/lender/db/lender-setting.table.ts`)

`lender` (`lender_code` pk) · `enabled` boolean not null default true · `updated_at` timestamptz. Seeded with the four rows by migration.

### `lender_switch_log` (`modules/lender/db/lender-switch-log.table.ts`), append-only

`id` uuid pk · `lender` `lender_code` not null · `enabled` boolean not null · `actor` text not null · `created_at` timestamptz not null default now(). Index `(created_at, id)`.

### `request_throttle` (`modules/throttle/db/request-throttle.table.ts`)

`id` uuid pk · `ip_hmac` bytea not null · `route` text not null (`consultation.create` | `consultation.requote` | `address.lookup`) · `status_code` smallint null (set after the response) · `error_code` text null (e.g. `IP_LIMIT`, `PATIENT_LIMIT`, `VALIDATION`, `CEP_NOT_FOUND`) · `created_at` timestamptz not null default now(). Index `(ip_hmac, route, created_at)`, `(created_at, id)`. Rows older than the IP window + 24 h are purged by `throttle.purge`.

## Relations (by origin file)

- `consultation.relations.ts`: `patient` (one, `consultation.patientId → patient.id`), `attempts` (many, `lenderAttempt.consultationId`), `offers` (many, `offer.consultationId`), `chosenOffer` (one, optional, `consultation.chosenOfferId → offer.id`).
- `patient.relations.ts`: `consultations` (many).
- `lender-attempt.relations.ts`: `consultation` (one), `offers` (many, `offer.attemptId`).
- `offer.relations.ts`: `attempt` (one), `consultation` (one).
