# Parcela Mais · Multi-lender pre-approval

> [🇧🇷 Português](README.md) · 🇺🇸 English

The clinic fills in the patient's signup once; the backend queries **4 simulated lenders in parallel**, shows each answer **live** and, within **10 s**, moves on with whatever came back. The patient compares the offers (Price amortization) and picks one. _(The animations are labelled in Portuguese, like the app.)_

![The journey: signup, live pre-approval, offers and choice](docs/assets/journey.gif)

## Contents

[Run it](#run-it) · [Architecture](#architecture) · [Parallel quote](#parallel-quote-and-the-10-s-deadline) · [Live status](#live-status-why-sse) · [Database](#data-model) · [Decisions & trade-offs](#decisions-and-trade-offs) · [Tests](#tests) · [Left out & next steps](#left-out-and-next-steps) · [AI usage](#how-i-used-ai)

## Run it

You need **Bun 1.4** and **Podman** (or Docker) with compose.

```bash
bun install
cp .env.example .env.local
bunx vp run up        # Postgres + Caddy + migrations + app + worker
```

Open **https://parcela.localhost:8443**. On the first run, `up` installs Caddy's local CA for your user (Windows/macOS ask once). `up` prints the backoffice URL and the dev credentials (`operador` / `parcela123`).

| Command                            | What it does                                                  |
| ---------------------------------- | ------------------------------------------------------------- |
| `bunx vp run up --prod`            | The same stack in production mode (built image, behind Caddy) |
| `bunx vp run doctor`               | Read-only diagnostics (ports, CA, database, migrations)       |
| `bunx vp run down`                 | Stops the containers **without deleting data**                |
| `bunx vp run prune`                | Full local reset (deletes the database volume)                |
| `bunx vp test` / `bunx vp run e2e` | Unit + integration tests / browser E2E                        |

**Forced scenarios:** on the _Financeiro_ step, the **Cenário de simulação** field forces all approve, Delta fails, Delta times out, or none approve (on in dev via `SIMULATION_CONTROLS=true`).

## Architecture

```mermaid
flowchart LR
    B["🌐 Browser<br/>React + TanStack Router"] -->|HTTPS| C["🔒 Caddy<br/>parcela.localhost:8443"]
    C --> A["⚙️ App<br/>TanStack Start + Elysia API"]
    A <-->|"SQL · LISTEN/NOTIFY"| P[("🐘 Postgres<br/>data + pg-boss queues")]
    W["🛠️ Worker<br/>pg-boss"] <-->|jobs| P
    W -->|"HTTP · 4 in parallel"| S["🏦 Simulated lenders<br/>Alfa · Beta · Gama · Delta"]
    A -. "SSE: snapshots" .-> B
```

- **One database, no Redis:** the queues (pg-boss) live in Postgres, and the jobs are created **in the same transaction** as the consultation.
- **One API:** the frontend only talks to the API (no SSR) through a typed client (Eden). The full contract is in the [API handoff](docs/features/pre-approval-journey/API_HANDOFF.md).
- **Lenders behind adapters:** the 4 simulations run as backend HTTP routes behind one interface; a real integration only swaps the adapter.

## Parallel quote and the 10 s deadline

![Parallel quote with a 10 s deadline](docs/assets/fan-out.gif)

```mermaid
stateDiagram-v2
    direction LR
    [*] --> PENDING: POST /consultations (202)
    PENDING --> APPROVED: approves
    PENDING --> REFUSED: refuses
    PENDING --> UNAVAILABLE: HTTP 500 / circuit breaker / switched off
    PENDING --> UNAVAILABLE: 10 s deadline (finalize job)
    APPROVED --> [*]
    REFUSED --> [*]
    UNAVAILABLE --> [*]
```

- The `POST` answers **right away** (`202 {id}`); each lender is its own job, so a slow one never holds the others back.
- The deadline is a **job scheduled** at `creation + 10 s` (survives restarts), and reads also finalize a consultation past its deadline.
- **No retries** inside the 10 s; a per-lender **circuit breaker** and a backoffice **on/off switch** protect the journey.
- An offer can be **chosen as soon as it arrives**; late answers are recorded without changing the choice.
- **Nobody approved?** The screen explains each outcome without exposing internal rules and suggests **trying a lower amount** (a new consultation for the same patient).

## Live status: why SSE

![Live status over SSE](docs/assets/live-updates.gif)

| Option     | Why / why not                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------- |
| **SSE** ✅ | The flow is server → browser only; plain HTTP, native reconnect, goes through the proxy unchanged |
| Polling    | Simple, but laggy or wasteful; kept as the fallback (`GET /consultations/:id`)                    |
| WebSocket  | Two-way for no reason; more infrastructure for the same result                                    |

Every connection starts with the **full snapshot**; Postgres `NOTIFY` only says "re-read"; a re-read every **2 s** covers a lost notification; a dropped connection reconnects with **backoff** (0.5 → 1 → 2 → 4 s). Reloading the page rebuilds everything from the consultation URL.

## Data model

```mermaid
erDiagram
    PATIENT ||--o{ CONSULTATION : "makes"
    CONSULTATION ||--|{ LENDER_ATTEMPT : "4 attempts"
    LENDER_ATTEMPT ||--o{ OFFER : "1 per term"
    CONSULTATION |o--o| OFFER : "chosen offer"
    PATIENT {
        uuid id
        bytea cpf_ciphertext
        bytea cpf_hmac
        text full_name
        date birthdate
        text phone
    }
    CONSULTATION {
        uuid id
        text idempotency_key
        bigint treatment_amount_cents
        text quote_status
        timestamptz deadline_at
        uuid chosen_offer_id
    }
    LENDER_ATTEMPT {
        uuid id
        text lender
        text status
        text reason
        bigint approved_cents
        int latency_ms
    }
    OFFER {
        uuid id
        int term_months
        bigint installment_cents
        bigint total_cents
    }
```

Money is stored in **integer cents**; the installment uses the **Price formula** with _half-up_ rounding in the pricing service. The **CPF** is encrypted (AES-256-GCM) with an HMAC index for lookups; public responses carry no CPF and no other personal data. The backoffice also uses `lender_setting`, `lender_switch_log` and `request_throttle`.

## Decisions and trade-offs

| Decision                                      | Gain                                                       | Cost                                                        |
| --------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| Queues in Postgres (pg-boss), separate worker | One less piece of infra; jobs atomic with the consultation | More load on the database; two processes                    |
| Deadline as a scheduled job                   | Survives restarts and a slow worker                        | One more moving part (races covered by tests)               |
| No retries on lender calls                    | A predictable 10 s budget                                  | A one-off failure shows as "unavailable"                    |
| `Idempotency-Key` per submission              | Double clicks and network retries don't duplicate          | Two tabs = two consultations (capped at 5/24 h per patient) |
| No SSR; frontend through the API only         | One contract, ready for a native app                       | First paint waits for JS                                    |
| _Offset_ pagination in the backoffice         | Simple, fine at this volume                                | Worse than _keyset_ on huge tables                          |
| Signup draft in `sessionStorage` (30 min)     | A reload loses nothing                                     | On a shared computer it stays readable up to 30 min         |
| TypeBox everywhere (API, form, env)           | One source of truth for validation and types               | Less common than zod                                        |

The full record (35 decisions with alternatives) is in the [RFC](docs/features/pre-approval-journey/RFC-pre-approval-journey.md); the requirements in the [PRD](docs/features/pre-approval-journey/PRD-pre-approval-journey.md).

## Tests

```mermaid
flowchart LR
    U["Unit<br/>CPF · Price · sorting · form"] --> I["Integration (real Postgres)<br/>deadline · failures · races · idempotency"]
    I --> E["E2E (Playwright)<br/>journey · scenarios · keyboard · backoffice"]
```

- **258** unit and integration tests (Vitest, real Postgres, no factories) + **77** browser E2E tests.
- They cover what can break: CPF check digits, Price cents, a lender that never answers, HTTP 500, the finalizer racing a late worker, two simultaneous choices, the CPF kept out of public responses and URLs.
- **Case bonuses:** resume after reload ✅ · keyboard and screen-reader accessibility ✅ · per-lender logs and metrics (backoffice) ✅ · public deploy ⏭️

## Left out and next steps

- **Public deploy:** a VPS with real HTTPS; `vp run deploy` already exists and runs on the server itself, it needs a domain and a machine.
- **Tune Delta's circuit breaker:** it trips in ~7% of normal windows; raise the threshold or stop counting timeouts.
- **Observability:** logs are already JSON (tslog); export per-lender metrics and traces (OpenTelemetry).
- **Real authentication (Better Auth):** the backoffice has a single operator from env, and the cookie stays valid until it expires.
- **Real lender integrations and webhooks:** swap the simulated adapters for real APIs and receive asynchronous answers by webhook.

Out of scope by decision: post-choice stages (contract, payment) and lender retries.

## How I used AI

I built this together with an AI agent ([oh-my-pi](https://github.com/can1357/oh-my-pi), Claude model) in a single ~30 h session. I decided the stack, scope and rules; the agent proposed alternatives, wrote the code and tests, and audited its own work.

```mermaid
flowchart LR
    G["🔥 Grill<br/>30 rounds of questions"] --> D["📄 RFC + PRD"]
    D --> C["🔎 Discovery<br/>contracts + 243 checks"]
    C --> S["🧩 Implementation<br/>in slices, with subagents"]
    S --> A["🛡️ 3 adversarial audits<br/>FAIL → FAIL → PASS"]
    A --> H["🤝 API handoff<br/>fact-checked 3×"]
```

```mermaid
pie title Who decided (91 decisions)
    "Me" : 47
    "I asked, the agent designed" : 9
    "The agent recommended, I accepted" : 18
    "The agent (implementation and audits)" : 17
```

- **I decided:** the stack (TanStack Start, Elysia, Bun, Vite+, TypeBox, pg-boss instead of Redis), Podman/Docker with one command, ops commands with no remote connections, no SSR, business rules centralized in the domain, circuit breaker + on/off switch, tests on real Postgres, _offset_ pagination and the signup UX (blur validation, review step, buttons, theme); plus the bugs I found testing by hand.
- **I asked, the agent designed:** the `sessionStorage` draft, local HTTPS with automatic trust, `vp run down`, backoffice access.
- **The agent recommended, I accepted:** SSE with snapshots, one job per lender + finalizer, no retries, encrypting only the CPF, a capability URL without personal data.
- **The agent decided alone:** integer cents with _half-up_ rounding, `Idempotency-Key`, LISTEN before the snapshot + 2 s re-read, and the audit fixes (data leaks, the dev server exposed on the network).
- **Every decision, with its owner and evidence:** [docs/DECISOES.md](docs/DECISOES.md) (in Portuguese; quoted evidence kept as written).

## Documentation

[RFC](docs/features/pre-approval-journey/RFC-pre-approval-journey.md) · [PRD](docs/features/pre-approval-journey/PRD-pre-approval-journey.md) · [API handoff](docs/features/pre-approval-journey/API_HANDOFF.md) · [Grill](docs/features/pre-approval-journey/grill-decisions-2026-10-27-pre-approval-journey.md) · [Decisions](docs/DECISOES.md) · [CPF protection (visual)](docs/features/pre-approval-journey/cpf-protection-explainer.html)
