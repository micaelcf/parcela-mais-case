# RFC — Parallel multi-lender pre-approval journey with fault-tolerant orchestration, offers and backoffice

| Field                 | Value                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Impact**            | **HIGH**: it handles money (approved amounts, installments, chosen offers) and PII (CPF encryption), introduces a new persisted schema and a new architecture (Elysia v2, pg-boss worker, VPS deployment), and every public consultation triggers four credit inquiries.                                                                                    |
| **Status**            | `parcela-mais-case`: Stage 5 complete (2026-10-28): adversarial audit PASS after 3 rounds (`.ef/pre-approval-journey/log.md`); [API_HANDOFF.md](./API_HANDOFF.md) written from the code and fact-checked, and it supersedes this RFC wherever they disagree. RF-703 Docker run still unproven (no Docker CLI on the build workstation). Open: O1–O3, O5–O10 |
| **Driver**            | Micael                                                                                                                                                                                                                                                                                                                                                      |
| **Approver**          | Micael                                                                                                                                                                                                                                                                                                                                                      |
| **Contributors**      | `parcela-mais-case`: Micael                                                                                                                                                                                                                                                                                                                                 |
| **Informed**          | none                                                                                                                                                                                                                                                                                                                                                        |
| **Target repos**      | `parcela-mais-case` (single repository)                                                                                                                                                                                                                                                                                                                     |
| **Ticket**            | none (origin: [grill-decisions](./grill-decisions-2026-10-27-pre-approval-journey.md))                                                                                                                                                                                                                                                                      |
| **Grilled decisions** | [grill-decisions-2026-10-27-pre-approval-journey.md](./grill-decisions-2026-10-27-pre-approval-journey.md), the **source of truth for rationale**                                                                                                                                                                                                           |
| **Ground truth**      | [knowledge/stack-baseline.md](../../../knowledge/stack-baseline.md)                                                                                                                                                                                                                                                                                         |
| **Companion**         | [cpf-protection-explainer.html](./cpf-protection-explainer.html) (interactive explanation of D16)                                                                                                                                                                                                                                                           |
| **Scale**             | `standard` (from the grill header)                                                                                                                                                                                                                                                                                                                          |
| **Created**           | 2026-10-27                                                                                                                                                                                                                                                                                                                                                  |

> Where this RFC and [grill-decisions](./grill-decisions-2026-10-27-pre-approval-journey.md) conflict, **grill-decisions wins**.
> Decision anchors **D1–D26** map 1:1 to grill questions **Q1–Q26**. Grill **Q2** was a PIVOT and produced no decision. Its anchor **D2** records the pivot, and the deploy decision is **D2b** (grill Q2b).
> The grill's §3 "Decisions I took myself" are numbered D1–D20 _there_. Here they are renamed **AD1–AD20** (agent decisions) so they don't collide with the D anchors. AD*n* = grill §3 D*n*.

---

## Background

**Current state.** The repository is a TanStack Start template (`@tanstack/react-start` 1.169.4, Vite+ 1.3.0, React 19). It contains an example `todos` table on Drizzle 0.45.1, zod-based env, and a Vercel deploy target (`knowledge/stack-baseline.md`). It has no backend framework, no job system, no domain schema and no UI kit.

**The problem.** A clinic fills in a patient's data once, and the system must query four lenders in parallel and show offers as they arrive. Lenders respond at different speeds: Alfa 0.5–1.5 s, Beta 2–5 s, Gama 1–3 s, Delta 4–15 s with 30 % HTTP 500s. Some refuse, some fail and some never answer. The clinic has the patient in front of them and needs a useful answer within at most 10 s, even when integrations fail. The source specification is the technical case PDF (_Case Técnico · Dev Full Stack Sênior_, p.1–3). The reference architecture is the prep HTML (`jornada-credito-parcela-mais.html`).

**Why now.** The owner chose to build this as a real implementation, with real tests, real endpoints and a real deploy, rather than as a throwaway exercise. The evaluation framing is deferred to the audit phase.

**Cost of inaction.** None in production terms: there are no users and no traffic, and no baseline numbers exist. The cost is that the PDF's mandatory behaviours go undemonstrated: partial results under failure, the 10 s deadline, persisted choice, and tests on CPF, Price and orchestration.

**Corrections carried from the grill** (source claims proven false, grill §2): C1 the Vercel target can't host a persistent worker → VPS (D2, D2b). C2 Vite+ runs on Node, so Bun is only the container runtime (D3). C3 the HTML reference architecture needs persistent processes, which the VPS provides (D8). C4 `elysia-nazli` is rejected: no Node support, and the wrong IP behind the proxy (D22). C5 drizzle 0.45 + zod doesn't follow Elysia v2's guidance (D23). C6 the Eden SSR branch is unused under no-SSR (D25). C7 the PDF's "explain the reason" vs the HTML's "no sensitive reason" is reconciled with canonical categories (D21). C8 the PDF's lenders Alfa/Beta/Gama/Delta are built, not the HTML's lenders. C9 a public CPF mask leaks 6 of the 9 base digits, so no CPF is shown publicly (D13).

---

## Assumptions

Rows come from each grill record's _Riskiest assumption_, _Test_ and _Would reopen if_. Owner for all rows: Micael.

| #   | Assumption (decision)                                                                                                   | Evidence                               | Cheap test                                                                                                                   | Invalidated if                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | A pipeline/lender-health dashboard covers the "financial dashboard" ambition (D1)                                       | A: confirmed by the user in D25        | n/a (confirmed)                                                                                                              | A requirement appears for proposal submission, lender callbacks or disbursement                              |
| 2   | Losing the VPS disk is acceptable until `DATABASE_URL` moves to a managed provider (D2b)                                | B                                      | `podman compose up` and `docker compose up` both healthy from a clean clone                                                  | Real patient data is stored, the trial ends with no paid continuation, or availability needs exceed one host |
| 3   | Code that passes on Node behaves identically on Bun 1.4.x (`pg` sockets, timers, `AbortSignal.timeout`, streaming) (D3) | B                                      | `vp run up --prod` + all four forced scenarios before the first deploy                                                       | Any defect reproduces on one runtime but not the other                                                       |
| 4   | A cold `compose build` on the VPS takes minutes without degrading the running app (D4)                                  | B                                      | Time a cold build while looping `/api/health`                                                                                | Build > 5 min, visible latency/OOM, or a rollback needed faster than a rebuild                               |
| 5   | Failed deploys are rare enough that the next successful deploy reclaims disk (D5)                                       | B                                      | Three deploys with a failing health check in the middle; compare `podman system df`                                          | Disk > 70 % or "no space left on device"                                                                     |
| 6   | The operator always pulls the intended ref before `deploy` (D6)                                                         | B                                      | Compare `/api/health` `sha` with `git rev-parse origin/main`                                                                 | A deploy ships a stale SHA                                                                                   |
| 7   | `up --prod` is run locally before deploys that touch runtime-sensitive code (D7)                                        | A                                      | Walk all four forced scenarios under `up --prod` before the first deploy                                                     | A defect first appears on the VPS that `up --prod` would have caught                                         |
| 8   | Queue pickup latency with LISTEN/NOTIFY stays in the low milliseconds (D8)                                              | A                                      | p95 of `picked_at − created_at` over 100 consultations < 100 ms                                                              | p95 > 250 ms, or LISTEN/NOTIFY can't be held (e.g. a transaction-mode pooler)                                |
| 9   | The proxy and Eden pass SSE through unbuffered and typed (D9)                                                           | B                                      | `curl -N` through the proxy under `up --prod`; snapshots arrive per lender                                                   | The proxy buffers `text/event-stream`, Eden can't type the stream, or LISTEN is unstable                     |
| 10  | Losing ~30 % of Delta answers to 500s is acceptable (D10)                                                               | A/B                                    | 200 NORMAL consultations: Delta UNAVAILABLE ≈ 30 %, other lenders unaffected                                                 | A lender documents idempotent pre-approval, or lost offers matter more than duplicate inquiries              |
| 11  | Simulation traffic fills the 20-attempt window often enough for the breaker to engage (D11)                             | B                                      | Pure breaker-derivation unit tests + an integration test with the simulator's Delta failure rate at 100 % for NORMAL traffic | False trips in normal mode, or the breaker never engages                                                     |
| 12  | One shared operator identity is enough for audit (D12)                                                                  | A                                      | Missing/tampered/expired cookie on `/api/backoffice/*` → 401                                                                 | A second operator needs access, or one session must be revoked alone                                         |
| 13  | Anyone holding the consultation link is entitled to choose the offer (D13)                                              | A/B                                    | Public payloads contain no CPF digits, birthdate, phone or income; public path never loads the encryption key                | Choosing gains a consequence beyond recording intent (e.g. submission to a lender)                           |
| 14  | Mid-form reloads are rare enough not to matter (D14)                                                                    | A                                      | Steps back/forward keep values; reload → empty form, nothing in Web Storage                                                  | Clinic feedback reports lost drafts                                                                          |
| 15  | "Last write wins" on patient contact fields is acceptable (D15)                                                         | A                                      | Same CPF twice with different phone/income → one patient, two consultations with intact frozen inputs                        | Retry-funnel measurement or contact history is required                                                      |
| 16  | The encryption keys never live where the DB dump lives (D16)                                                            | B                                      | `SELECT * FROM patient` shows no 11-digit CPF; re-upsert hits the same row via `cpf_hmac`                                    | Real patient data is stored, or compliance requires all identifiers encrypted                                |
| 17  | The pricing service is the only code path that produces `installment_cents`/`total_cents` (D17)                         | A                                      | Exactly one Price implementation exists; the worker imports the service                                                      | Offers need re-pricing after creation, or offer expiry is introduced                                         |
| 18  | `SIMULATION_CONTROLS` is reliably off wherever real lenders would be wired (D18)                                        | A                                      | Flag off: POST with `DELTA_FAILS` → 422. Flag on: each scenario 20/20                                                        | A real lender replaces a simulated one                                                                       |
| 19  | The worker → app HTTP hop never makes simulator unavailability look like lender unavailability (D19)                    | A (Node smoke run)                     | Stop the app container mid-run; attempts settle UNAVAILABLE with a distinguishable reason                                    | The hop eats into the 10 s budget, or `vp test` behaves differently from the Node smoke run                  |
| 20  | Every state a test needs is reachable through real code paths (D20)                                                     | A                                      | No orchestration test imports the DB client or a table object                                                                | An edge state is unreachable through real code, or suite time exceeds a few minutes                          |
| 21  | Lenders return a usable limit hint often enough for a specific suggestion (D21)                                         | A                                      | `NONE_APPROVE`: screen shows `AMOUNT_ABOVE_LIMIT` + Alfa's hint; requote frozen inputs equal except the amount               | Lenders return no hints, or requote is abused                                                                |
| 22  | The proxy always overwrites the client-IP header (D22)                                                                  | A/B                                    | Forged `X-Forwarded-For` through the proxy → the real peer is counted; 6th consultation for a CPF in 24 h → 429              | Legitimate clinics hit the cap, or the app is exposed without the proxy                                      |
| 23  | The TypeBox → Standard Schema adapter gives field-level paths and messages as good as a native library (D23)            | A/B (path mapping verified under Node) | An invalid CPF surfaces on the CPF field with the pt-BR message                                                              | The adapter can't map per-field paths, or drizzle v1 RC blocks a needed feature                              |
| 24  | Patients and clinics accept missing a possibly better late offer for speed (D24)                                        | A                                      | `DELTA_TIMES_OUT` + Alfa at ~1 s: choose → confirmation; Delta later TIMEOUT, choice unchanged                               | Chosen offers are regularly beaten by late offers in the same consultation                                   |
| 25  | Dashboard aggregates over raw tables stay fast without materialized views (D25)                                         | A                                      | 10k consultations seeded via the real API; each dashboard query < 200 ms                                                     | Any dashboard query > 500 ms                                                                                 |
| 26  | List volumes stay small enough for deep OFFSET + per-request `COUNT(*)` (D26)                                           | A                                      | 100k consultations; page 1 and page 900 by `created_at` < 200 ms                                                             | Any list endpoint's deep-page or count latency > 500 ms                                                      |

---

## Decision criteria

Defined before the options. Sources: the PDF's mandatory requirements and evaluation table (p.3–5) and the owner's brief. Must-haves are marked.

| #   | Criterion                                                                                                                            | Weight        | Source                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------- | --------------------------------------------------------------------------------------- |
| K1  | **Behaviour under failure.** The journey stays useful when lenders are slow, fail or refuse, and always closes by the 10 s deadline. | **Must-have** | PDF p.1, p.4 "Comportamento sob falha"; brief "fault and error tolerance"               |
| K2  | **Correctness.** CPF/age/amount validation, Price installments, offer ordering, persisted choice.                                    | **Must-have** | PDF p.1–2, p.4 "Correção"                                                               |
| K3  | **Database as the single source of truth.** Business state lives in Postgres; transport and UI are projections.                      | **Must-have** | Brief "Database as source of truth following single source of truth everywhere"         |
| K4  | **Tests on the critical parts.** CPF, Price and orchestration (timeout and failures) against real infrastructure.                    | **Must-have** | PDF p.3 "Obrigatório"; brief "real tests"                                               |
| K5  | **PII protection.** No CPF readable from a DB dump or from public responses.                                                         | High          | HTML LGPD card (`:234`, `:425`)                                                         |
| K6  | **Operability.** One-command run on Podman and Docker; local-only ops scripts.                                                       | High          | PDF p.4; user directives (`doctor`/`up`/`prune`/`deploy`, no remote connections)        |
| K7  | **Native-first toolchain alignment.** Elysia, Vite+ and TanStack Start used as their docs recommend.                                 | High          | Brief ("use everything native on elysia first", "follow tanstack start best practices") |
| K8  | **Demonstrability.** Each of the four PDF outcomes can be forced on demand.                                                          | **Must-have** | PDF p.3                                                                                 |

---

## Options considered

The feature-level architecture choice. Per-decision alternatives sit under each decision.

| Option                                                                                                  | Pros                                                                                                                                             | Cons                                                                                                      | Verdict                                                                 |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| (a) **VPS: Elysia in TanStack Start + pg-boss worker + Postgres, SSE, simulator behind HTTP adapters**  | Persistent worker makes the reference architecture buildable (K1, K3); per-lender bulkheads; one-command parity (K6); native Elysia/TypeBox (K7) | Operator owns the box; a single disk is a single point of data loss; two runtimes (Node dev, Bun prod)    | **Chosen**                                                              |
| (b) Original brief: Vercel, fan-out in `waitUntil`, `deadline_at` in the DB, lazy finalization, polling | Zero ops; `deadline_at` still guarantees closure                                                                                                 | No persistent worker, so no pg-boss, no LISTEN/NOTIFY, no breaker probe loop; Bun only via a beta runtime | Rejected: can't host the pg-boss consumer the owner chose (grill Q2/C1) |
| (c) Status quo: the template only                                                                       | No work                                                                                                                                          | None of K1, K2, K4 or K8 is met                                                                           | Rejected: delivers nothing the PDF requires                             |

---

## Decisions

### D1. Scope is journey stages 1–3 plus a pipeline/risk backoffice; no ledger (grill Q1)

The hard problems (fan-out, deadline, partial failure, idempotent choice) all live in stages 1–3. These stages move no money, so a ledger would have nothing real to record.

| Option                                            | Verdict                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Stages 1–3 done rigorously                        | **Chosen**                                                                                                                  |
| 1–3 + proposal & async analysis (webhook → inbox) | Rejected: ~2× scope, still no money movement, so still no ledger                                                            |
| Full 7 stages + double-entry ledger               | Rejected: 3–5× scope, every counterparty faked. Dissent preserved: a real ledger is the strongest proof that money balances |

**Evidence.** A.

**Decision.** Build signup → parallel pre-approval → offers → persisted choice. The backoffice shows consultations, lender health and offered/approved/chosen volume. Proposal submission, analysis, signing, disbursement and the ledger are out of scope.

### D2. Fan-out executor on Vercel: PIVOT, no decision (grill Q2)

The question was mis-framed. Vercel's lack of persistent processes is the constraint itself. pg-boss consumers are polling `work()` loops, and scheduling needs a live instance. **Reframed as D2b.** Evidence A.

### D2b. Deploy to a single VPS with one Podman/Docker-compatible compose stack (grill Q2b)

Persistent processes make pg-boss workers, `SKIP LOCKED`, LISTEN/NOTIFY and unbounded SSE possible. One command gives local/production parity.

| Option                                           | Verdict                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| All-in-one VPS (proxy + app + worker + Postgres) | **Chosen** (user)                                                          |
| VPS for app + worker, managed Postgres           | Rejected by user. Dissent preserved: PITR backups and survival of box loss |
| Vercel web + VPS worker                          | Rejected: two deploy targets and two runtimes                              |
| Stay on Vercel without pg-boss                   | Rejected: no real worker                                                   |

**Evidence.** B.

**Decision.** One compose file, runnable with both `podman compose` and `docker compose`, runs reverse proxy + Bun app + Bun worker + Postgres. Postgres is local by default; pointing `DATABASE_URL` elsewhere needs no code change. `vercel.json` and the Vercel target are obsolete (AD20).

### D3. Bun is the container runtime; Vite+ dev/test stays on Node; `src/` is runtime-portable (grill Q3)

`vp` manages a Node runtime. pg-boss needs `pg`, so one pool is shared through its `executeSql` adapter.

| Option                                | Verdict                                              |
| ------------------------------------- | ---------------------------------------------------- |
| Bun in prod/containers, portable code | **Chosen**, without a CI container smoke test (user) |
| `bunx --bun vp` everywhere            | Rejected: off vp's documented path; two DB drivers   |
| `bun test` instead of `vp test`       | Rejected: abandons the mandated Vite+ test runner    |

**Evidence.** A.

**Decision.** Bun is the package manager and the runtime of every container process. `vp dev`/`vp test` run on Node. `src/` uses only Web standards and `node:*` (no `Bun.*`). Drizzle uses `pg`, ~~sharing one pool with pg-boss~~.

**Amendment (2026-10-27, discovery).** pg-boss **owns a small pool of its own**: `new PgBoss({ connectionString, max: 3, useListenNotify: true, migrate: false })`. It's still the same `pg` driver. Jobs still join drizzle transactions via `boss.send(q, data, { db: fromDrizzle(tx, sql) })`, proven live: a rollback dropped both the row and the job. Why: with a shared pool, pg-boss's LISTEN wake-up needs a hand-written `listen()` adapter with heartbeat and reconnect, which pg-boss's built-in client already does (`pg-boss@12.38.0 dist/db.js:158-290`). Supersedes D3's "one pool" clause (user decision, discovery Q2). The single-driver goal is unchanged.

**Amendment (2026-10-28, implementation).** Bun running the TS sources directly (worker, migrate, ops scripts) resolves the extensionless `#/…` alias only through `tsconfig.json` `paths`, so the runtime image ships `tsconfig.json`; `package.json` `imports` alone made migrate fail with "Cannot find module" in the container. A lint override now forbids the `Bun` global and `bun`/`bun:*` imports under `src/`, keeping the D3 portability rule enforced rather than conventional.

**Amendment (2026-10-27, discovery).** On this workstation, rootless Podman (WSL) publishes container ports on IPv6 loopback only: `localhost`/`::1` connect, literal `127.0.0.1` is refused (reproduced). Every local URL uses the hostname `localhost`, never `127.0.0.1`, and `doctor` flags a `127.0.0.1` host in `DATABASE_URL`.

### D4. `deploy` builds on the box; rollback = deploy an earlier ref (grill Q4)

No registry credentials or image transport, and a migration gate. Partially superseded by the no-remote-connections directive and D6.

| Option                          | Verdict                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| Build on the box                | **Chosen** (user)                                                                             |
| SHA-tagged image via a registry | Rejected by user. Dissent preserved: immutable artifacts and a no-rebuild rollback in seconds |
| Image tarball over SSH          | Rejected: full transfer every deploy (and later forbidden by the no-remote rule)              |

**Evidence.** B.

**Decision.** `deploy` runs **on the target host** (the operator connects manually). Steps: `compose build` → one-shot `migrate` service that must exit 0 → `compose up -d` → health check on localhost → cleanup of this project's old images and build cache. ~~SSH + `git fetch`~~ (superseded by the grill directive and D6).

### D5. `prune` is a local dev reset only (grill Q5)

`prune` can't reach production, so it can't destroy production data. Disk cleanup on the VPS is tied to the only event that creates garbage there: a build.

| Option                                                          | Verdict                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| Local dev reset only; `deploy` cleans up after a healthy deploy | **Chosen** (user)                                            |
| Tiered, prod volume untouchable, `--remote`                     | Rejected by user (and later forbidden by the no-remote rule) |
| Tiered, prod wipe behind a confirmation                         | Rejected: one prompt between a habit and data loss           |

**Evidence.** B.

**Decision.** `prune` = `compose down -v` (including the local DB volume) + this project's image/build-cache cleanup. No remote mode.

**Amendment (2026-10-28, verification).** On Docker the build-cache step is skipped (and reported): BuildKit's cache carries no project label, so `docker builder prune` would clear every project's cache. On Podman the cache is this project's labelled intermediate images and is pruned. Applies to `deploy`'s cleanup too (RF-709).

### D6. `deploy` builds the current checkout only, with no git fetch (grill Q6)

This follows "no remote connections in scripts" literally, and makes the deployed version exactly the visible HEAD.

| Option                         | Verdict                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Build current checkout only    | **Chosen** (user)                                                                                         |
| `deploy` fetches origin itself | Rejected: an outbound call from a script. Dissent preserved: one command, and no "forgot to pull" failure |

**Evidence.** A.

**Decision.** `deploy` refuses a dirty working tree and stamps `git rev-parse HEAD` into the image and `/api/health`. Rollback = `git checkout <old-sha> && vp run deploy`. No ops script (`doctor`, `up`, `prune`, `deploy`) opens SSH or any session to another host.

### D7. `up` defaults to dev mode; `up --prod` brings up the prod-parity stack (grill Q7)

The default is the everyday loop. One entry point covers dev and the PDF's one-command run, and `deploy` reuses `up --prod`.

| Option                                            | Verdict                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| One entry point: `up` = dev, `up --prod` = parity | **Chosen** (user)                                                            |
| `up` = parity, a separate `dev`                   | Rejected by user. Dissent preserved: parity runs less often when it's opt-in |
| `up` = dev only                                   | Rejected: Bun containers never run locally                                   |

**Evidence.** A.

**Decision.** `vp run up` = Postgres container + gated migrate + `vp dev` (HMR) + worker in watch mode. `vp run up --prod` = Bun containers for app + worker + proxy + Postgres, gated migrate, waits for health and prints the URL. `deploy` = `up --prod` + dirty-tree guard + SHA stamp + cleanup. `doctor` is read-only and local (AD3).

### D8. Per-lender pg-boss jobs sent in the consultation's transaction; `lender_attempt` is the business truth (grill Q8)

A transactional send turns the commit into the outbox. One queue per lender is a bulkhead. Guarded updates, a finalizer and lazy read finalization give exactly-once terminal state.

| Option                                     | Verdict                                                        |
| ------------------------------------------ | -------------------------------------------------------------- |
| 4 per-lender jobs + finalize job, same TX  | **Chosen**                                                     |
| In-process fan-out; pg-boss only finalizes | Rejected. Dissent preserved: no pickup latency and fewer parts |
| 1 job per consultation                     | Rejected: no per-lender isolation; a crash loses all four      |

**Evidence.** A.

**Decision.** The create transaction inserts the consultation, 4 `PENDING` attempts and `deadline_at = created_at + 10 s` (AD18). In the same TX it sends one job per lender queue plus a `consultation.finalize` job with `startAfter = deadline_at`. The worker calls the lender with timeout = `deadline_at − now` and settles with a guarded `UPDATE … WHERE status = 'PENDING'`. The finalizer marks leftovers `UNAVAILABLE` and closes the consultation. Reads past `deadline_at` lazily finalize as a backstop. pg-boss owns delivery only.

### D9. SSE with snapshot-on-connect; NOTIFY is only a "re-read" hint (grill Q9)

A lossy NOTIFY then costs latency, never correctness. Resume after reload falls out for free.

| Option                            | Verdict                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| SSE: snapshot + NOTIFY hint       | **Chosen**                                                                              |
| Polling ~700 ms                   | Rejected. Dissent preserved: stateless, no LISTEN connection, lag invisible inside 10 s |
| SSE deltas + Last-Event-ID replay | Rejected: an event table purely for transport                                           |

**Evidence.** B.

**Decision.** `GET /api/consultations/:id/events`: the handler LISTENs on the consultation's channel **before** reading the snapshot, then emits a full snapshot (lazily finalizing). It re-reads and emits on each NOTIFY, plus every 2 s while non-terminal, and closes at terminal. The worker's `pg_notify` runs inside the guarded UPDATE's transaction. No deltas, no event table. (Includes the grill's post-review amendment.) ~~The client reconnects automatically~~ (grill Q9 wording).

**Amendment (2026-10-27, discovery): CHANGED.** Facts from the Elysia 2.0.0-rc.0 / Eden 2.0.0-rc.0 probe, on Node 25.9 and Bun 1.4.4:

- **Every yield must be wrapped in `sse()`.** A generator yielding plain objects streams concatenated `application/json`, which Eden types as an iterable but throws on at runtime.
- **Eden is fetch-based.** No auto-reconnect and no `Last-Event-ID`. Reconnection is **our client hook's job**: reconnect with backoff until the consultation is terminal.
- **Eden doesn't cancel on `break`.** The client must pass an `AbortController` signal and abort on unmount.
- **The server must race every wait against `request.signal`.** Otherwise `finally` (unsubscribe) is delayed until the pending wait resolves.

"LISTEN before snapshot" is realised as **one app-process LISTEN client** on a single channel (`consultation_updated`, payload = consultation id), fanned out in memory to subscribed streams. Each stream subscribes before reading its snapshot. This avoids one pinned connection per open stream. Supersedes "the client reconnects automatically". No decision reopens: D9's reopen conditions (proxy buffering, untyped stream, unstable LISTEN) aren't matched.

### D10. No retry of lender calls (grill Q10)

Delta's latency leaves no room in the 10 s budget for a retry, and a duplicate pre-approval is a duplicate credit inquiry against the patient.

| Option                       | Verdict                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| No retry                     | **Chosen**                                                               |
| One budget-aware retry       | Rejected. Dissent preserved: would recover some of Delta's 30 % failures |
| pg-boss retries with backoff | Rejected: invisible to attempt state; rarely fits the deadline           |

**Evidence.** A (latency), B (inquiry harm).

**Decision.** One call per attempt; `retryLimit: 0` on lender queues. 5xx, network error or timeout → `UNAVAILABLE` with a typed reason (`LENDER_ERROR`, `TIMEOUT`, …). The port's error type carries `retryable` for a future opt-in.

### D11. Automatic circuit breaker plus a manual kill switch; manual wins (grill Q11)

During an outage, the breaker shows "indisponível" immediately. 16/20 keeps false trips on Delta's normal noise negligible (P = 5.6×10⁻⁶). The manual switch covers announced maintenance.

**Correction (2026-10-28, verification, audit QN1).** The 5.6×10⁻⁶ figure counts only Delta's 30 % HTTP 500s. Timeouts count as failures too, and Delta answers in 4–15 s (uniform) against a 10 s deadline, so ≈ 45 % of the calls that don't 500 time out: per-call failure ≈ 0.62 and P(≥ 16 of 20) ≈ 7.0 %. Real patients therefore lose Delta for 30 s at a time. Grill Q11's reopen condition has fired; the remedy is an owner decision (O10).

| Option                        | Verdict                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------ |
| Both, manual takes precedence | **Chosen** (user)                                                              |
| Automatic only                | Rejected by user                                                               |
| Manual only                   | Rejected by user. Dissent preserved: simpler and more legible for a simulation |
| No breaker                    | Rejected: every consultation waits the full 10 s during an outage              |

**Evidence.** A (binomial), B (thresholds untuned).

**Decision.** Manual: a disabled lender → attempt settles `UNAVAILABLE(DISABLED)` with no call. Automatic: the breaker state is derived, never stored, from that lender's last 20 settled **`NORMAL`-scenario** attempts within 5 min. ≥ 16 failures → `UNAVAILABLE(CIRCUIT_OPEN)` with no call. After 30 s one probe call is allowed. Forced-scenario attempts never count and never probe. (Includes the grill's post-review amendment.)

**Amendment (2026-10-28, verification) — gap closed: forced-scenario attempts bypass the automatic breaker entirely** (they're neither counted, nor probes, nor blocked by an open or half-open circuit); the manual kill switch still applies to them. Why: RF-214 needs each forced scenario to hold 20/20, but Delta's own NORMAL behaviour fails often (≈30 % 500s plus timeouts at 4–15 s against a 10 s deadline), so ordinary traffic periodically opens Delta's circuit; observed after the audit fixes, every `ALL_APPROVE`/`DELTA_FAILS` E2E run then showed Delta `CIRCUIT_OPEN`. The breaker is derived from `NORMAL` traffic only, so it governs `NORMAL` traffic only. Supersedes the audit-round-1 interim rule "forced attempts under half-open settle `CIRCUIT_OPEN`" (lead decision, vetoable).

### D12. Backoffice auth: one operator from env, signed session cookie (grill Q12)

Representative, not a user-management feature, but enforced server-side on every backoffice route. Kill-switch changes are attributable.

| Option                              | Verdict                                                      |
| ----------------------------------- | ------------------------------------------------------------ |
| Single env operator + signed cookie | **Chosen**                                                   |
| Users table + DB sessions           | Rejected. Dissent preserved: per-person audit and revocation |
| HTTP Basic Auth                     | Rejected: no logout; credentials on every request            |

**Evidence.** A.

**Decision.** `BACKOFFICE_USERNAME` + `BACKOFFICE_PASSWORD_HASH` (scrypt via `node:crypto`, AD7). Login issues an HMAC-signed cookie (httpOnly, Secure, SameSite=Lax, 8 h). An Elysia guard protects `/api/backoffice/*`, plus a route guard on `/backoffice/*`. Kill-switch changes are appended to an immutable log with `actor = username`.

**Amendment (2026-10-28, implementation).** `BACKOFFICE_PASSWORD_HASH` is encoded `scrypt:N:r:p:saltB64:hashB64`, colon-separated. A `$`-separated value doesn't survive env files: Bun's `--env-file` expands `$…` even inside single quotes, and Compose interpolates `$` in `env_file`. Supersedes the `$`-separated format in the Stage 3 contract.

**Amendment (2026-10-28, verification, audit Q-3).** `Secure` is set only when `APP_DOMAIN` is set (Caddy serves TLS). Over plain `http://localhost` a `Secure` cookie isn't stored by the browser, so the local and `up --prod` stacks (no TLS) send it without `Secure`. httpOnly, SameSite=Lax and the 8 h max-age are unchanged.

**Amendment (2026-10-28, implementation).** The session is verified **before** validation, so an unauthenticated request with an invalid body gets 401, never a 422 that would reveal the schema (RF-602). Elysia 2 builds the cookie jar only after validation, so the guard runs Elysia's own signed-cookie check on the raw `Cookie` header in the route's `parse`/`transform` stages. Login deletes any incoming `bo_session` before signing the new one: Elysia re-verifies incoming signed cookies when serialising the response, so a stale cookie (e.g. after a secret change) turned login into a 500 until it expired.

### D13. Public access through a capability URL; public responses carry no PII and no CPF (grill Q13)

Resume across reloads and devices with no session machinery. A leaked link exposes amounts and offers, not identity.

| Option                                     | Verdict                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| Capability URL + PII-free public responses | **Chosen**                                                              |
| Browser-bound resume cookie                | Rejected. Dissent preserved: stops a leaked link from choosing an offer |
| Capability URL with full data              | Rejected: a forwarded link leaks the CPF, birthdate, phone and income   |

**Evidence.** A/B.

**Decision.** Route `/consultas/$consultationId` (UUIDv7). Public GET/SSE/choose/requote responses carry status, attempts, offers, the chosen offer, the requested amount and the patient's **first name only**. They contain no CPF digits and no mask, and the public read path never decrypts. ~~Masked CPF `***.456.789-**`~~ (removed by the grill's post-review amendment, C9).

### D14. The signup form is in-memory across steps; resume starts at submit (grill Q14)

Covers "nada se perde se a pessoa voltar um passo" while keeping PII out of browser storage and out of the DB until submit.

| Option                 | Verdict                                                   |
| ---------------------- | --------------------------------------------------------- |
| In-memory across steps | **Chosen**                                                |
| sessionStorage draft   | Rejected: PII in browser storage                          |
| Server-side draft      | Rejected: persists unsubmitted PII; needs a retention job |

**Evidence.** A.

**Decision.** One form instance spans all steps, with state above the step routes. A reload before submit restarts the form. After submit, the consultation URL resumes everything. Dissent preserved: an accidental reload loses typed data.

### D15. The patient is unique by CPF; each consultation freezes its decision inputs; consultations are not linked (grill Q15)

Each past decision stays explainable from its own row, and a person's consultations can be grouped without a link between consultations.

| Option                                                          | Verdict                                       |
| --------------------------------------------------------------- | --------------------------------------------- |
| Patient by CPF + immutable consultation snapshot, no retry link | **Chosen** (user removed the link)            |
| No patient entity                                               | Rejected: no home for contact updates         |
| Consultation reads live patient data                            | Rejected: past decisions become unexplainable |

**Evidence.** A.

**Decision.** `patient` is unique on the CPF blind index, upserted on submit with last-write-wins contact fields. `consultation` references the patient and freezes monthly income, treatment amount, birthdate and age at submission. No `retry_of_consultation_id`. Dissent preserved: the smaller-amount retry funnel can only be inferred.

### D16. Encrypt the CPF only (AES-256-GCM) with an HMAC blind index (grill Q16)

The CPF is the identifier that links a person to bureaus and fraud. Business numbers stay aggregatable in SQL. See [the explainer](./cpf-protection-explainer.html).

| Option                         | Verdict                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| CPF encrypted + HMAC index     | **Chosen**                                                                              |
| Plaintext, access control only | Rejected: a dump is a CPF list                                                          |
| Encrypt all PII                | Rejected. Dissent preserved: a dump still exposes names, phones, birthdates and incomes |

**Evidence.** A/B.

**Decision.** `cpf_ciphertext` (AES-256-GCM, key version per row) + `cpf_hmac` (HMAC-SHA256, unique). Keys `PII_ENCRYPTION_KEY` and `PII_HMAC_KEY` from env, validated at boot. Details in AD8: `"cpf:v1:"` HMAC input, AAD = `cpf_hmac`, a single-`bytea` envelope, decryption only in the authenticated backoffice detail, upsert never rewrites the ciphertext.

### D17. Offers are immutable rows built by the pricing domain service (grill Q17)

What the patient saw and what they chose are the same row. A later formula fix can't rewrite history. Business rules live in one service per feature module, and entry points stay thin (user directive).

| Option                                        | Verdict                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| Immutable offer rows from the pricing service | **Chosen** (user moved pricing out of the worker into the service)             |
| Store the lender answer, compute on read      | Rejected. Dissent preserved: one fewer table; a pricing fix applies everywhere |

**Evidence.** A.

**Decision.** On `APPROVED`, the same transaction inserts one `offer` per term: approved cents, monthly rate, term, installment cents, total cents. Offers are never updated. The choice is a guarded, set-once `chosen_offer_id`. Money handling per AD11: integer cents, exact decimal Price, half-up rounding, `total = installment × n`, and the front only formats. Workers, HTTP routes and SSE handlers hold no business rules.

### D18. Forced scenarios are picked on the form and stored on the consultation, behind an env flag (grill Q18)

The PDF requires forcing each outcome on demand. Per-consultation state means simultaneous users don't affect each other, and a forced failure is never mistaken for a real one.

| Option                            | Verdict                                            |
| --------------------------------- | -------------------------------------------------- |
| Form picker, persisted, env-gated | **Chosen** (user)                                  |
| Global switch in the backoffice   | Rejected: global state affects concurrent users    |
| Hidden header, not persisted      | Rejected: outcomes become unexplainable afterwards |

**Evidence.** A.

**Decision.** `simulation_scenario` ∈ {`NORMAL`, `ALL_APPROVE`, `DELTA_FAILS`, `DELTA_TIMES_OUT`, `NONE_APPROVE`}, carried in the job payload and read only by the simulated lenders. With `SIMULATION_CONTROLS=true` the form shows the picker. Otherwise the picker isn't rendered and the API rejects non-`NORMAL` values with 422. Dissent preserved: a simulation concern lives in the domain schema.

**Amendment (2026-10-28, implementation).** A forced outcome caps Delta's latency at 4–8 s in `ALL_APPROVE`, `DELTA_FAILS` and `NONE_APPROVE` (only `DELTA_TIMES_OUT` exceeds the deadline). With Delta's NORMAL 4–15 s, about 45 % of forced 500s/refusals would land after the 10 s deadline and show as `TIMEOUT`, so the scenario couldn't hold 20/20 (RF-214). Normative: every forced outcome other than `DELTA_TIMES_OUT` answers before the deadline.

### D19. The lender simulator is mounted as an Elysia plugin, behind real per-lender HTTP adapters (grill Q19)

The port/adapter boundary is real code (HTTP calls, aborts, status mapping). Going live is a base-URL and mapper change.

| Option                              | Verdict                                                           |
| ----------------------------------- | ----------------------------------------------------------------- |
| Simulator HTTP APIs + real adapters | **Chosen** (user), tested via Elysia's `handle` pattern           |
| In-process fake adapters            | Rejected. Dissent preserved: simpler, faster, fully deterministic |
| Separate simulator container        | Rejected: one more process                                        |

**Evidence.** A. Node smoke run on 2026-10-27: Elysia 2 RC, Eden RC, drizzle 1.0 RC (typebox) and TypeBox 1.4.3 under Node v25.9.0.

**Decision.** Simulator at `/api/simulator/lenders/{alfa|beta|gama|delta}/…`, each lender with its own JSON contract and the PDF's behaviour. One adapter per lender implements the common lender port with an injected `fetch` and an `AbortSignal` (remaining budget), mapping into the canonical attempt result. Tests inject `(req) => simulator.handle(req)` ~~and import from `vitest`~~. Elysia 2's route signature is `(path, hook, handler)`.

**Amendment (2026-10-27, discovery): CHANGED.** Test files import from **`vite-plus/test`**, not `vitest`. Vite+ 1.3.0 re-exports the bundled Vitest 5.0.5 there (`node_modules/vite-plus/docs/guide/test.md:13-16`, `vitest-v5.md:129`), and `vite.config.ts:18` makes `vite-plus/prefer-vite-plus-imports` a lint **error**, so a `vitest` import fails `vp check`. Supersedes the "import from `vitest`" clause of D19 and the grill Q19 evidence line. No decision reopens: the D19 reopen condition (Vitest behaving differently from the Node smoke run) isn't matched; this is a correction to the import path only.

### D20. Integration tests use real Postgres and create data only through real code (grill Q20)

Race safety needs real concurrent connections. Factories can produce states the real code never would.

| Option                                   | Verdict                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| Real Postgres from compose; no factories | **Chosen** (user added the no-factory rule)                                            |
| PGlite in-process                        | Rejected: single connection, so races can't occur. Dissent preserved: zero infra, fast |
| Testcontainers per run                   | Rejected: socket setup for Podman on Windows; cold starts                              |

**Evidence.** A.

**Decision.** A throwaway database per run, with the real drizzle migrations and the pg-boss schema applied, dropped afterwards. Setup goes only through repositories, domain services and the Elysia app (`handle`/Eden). Pure logic (CPF, Price, breaker, adapter mapping) is unit-tested without a DB.

### D21. No-approval path: canonical reasons, lender hints, server-side requote (grill Q21)

Satisfies the PDF's "explain the reason, offer a next step" without sensitive reasons. Lender policy stays inside the lenders.

| Option                                             | Verdict                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| Canonical reason + hint + server-side requote      | **Chosen**                                                         |
| The core computes the suggestion from lender rules | Rejected: copies lender policy into the core                       |
| Generic message, back to the form                  | Rejected. Dissent preserved: no hint dependency, no extra endpoint |

**Evidence.** A.

**Decision.** Adapters map refusals to `AMOUNT_ABOVE_LIMIT`, `PROFILE_NOT_ELIGIBLE` and the non-answer reasons, plus an optional `maxApprovableCents` hint when the lender returns one (the simulated lenders do). The screen explains each category and suggests the highest hint. `POST /api/consultations/:id/requote` creates a new standalone consultation from the source's patient data. Guards (AD10 + grill amendment): source terminal with zero approvals; strictly lower amount; its own idempotency key; the per-patient cap applies; the scenario resets to `NORMAL` unless explicitly sent with the flag on.

### D22. Abuse limits: a per-patient domain cap plus a native per-IP guard (grill Q22)

The harm is per patient, so the binding limit lives in the domain and is counted from the DB. The per-IP cap catches spraying across many CPFs.

| Option                                                        | Verdict                                                                                                                 |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Per-CPF domain cap + native Elysia guard counting in Postgres | **Chosen** (user, after C4)                                                                                             |
| `elysia-nazli` with a header key                              | Rejected: "Node.js is not supported"; wrong IP behind `app.fetch` + proxy. Dissent preserved: library features for free |
| No limits                                                     | Rejected: an open inquiry cannon against any known CPF                                                                  |

**Evidence.** A/B.

**Decision.** At most _N_ consultations per patient per rolling window, checked inside the creation transaction, else 429. It covers create and requote. A native `onBeforeHandle` guard on both POST routes counts rows in `request_throttle` (`ip_hmac`, `route`, `created_at`), recorded **before** validation, purged by a pg-boss scheduled job. The client IP is read only from the header the proxy overwrites. IPs are stored only as `HMAC("ip:v1:" + ip)` (AD9). Thresholds: Open question O2.

**Amendment (2026-10-28, implementation) — CHANGED: not `onBeforeHandle`.** In Elysia 2 `onBeforeHandle` runs after validation and can't count invalid requests. The per-IP guard is a route macro whose `parse` hook records and counts the request before the body is read (so malformed JSON counts too) and whose `transform` raises `IP_LIMIT` before validation; `afterResponse` stores the outcome. The cap is counted per (IP, route). Malformed JSON answers 422 `VALIDATION` (it was a 500).

### D23. drizzle v1 RC + TypeBox everywhere, with one in-house Standard Schema adapter (grill Q23)

Elysia v2's official guidance is `drizzle-orm@rc` + `drizzle-orm/typebox`. One schema library from table to form to env. drizzle v1 removes v0 relations.

| Option                                       | Verdict                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| drizzle v1 RC + TypeBox everywhere           | **Chosen** (user)                                                       |
| drizzle 0.45 + drizzle-zod                   | Rejected: v0 relations are removed in v1                                |
| drizzle v1 RC + `drizzle-orm/zod` everywhere | Rejected by user. Dissent preserved: native Standard Schema, no adapter |

**Evidence.** A; adapter path mapping verified under Node (`/patient/cpf` → `['patient','cpf']`).

**Decision.** Generated TypeBox schemas, refined/picked per contract, are the Elysia route schemas (validation, OpenAPI, Eden). TanStack Form and `@t3-oss/env-core` consume them through one shared `toStandardSchema` adapter: `typebox/value` errors → issues, path from `instancePath`, pt-BR messages from a custom option or a per-keyword table. zod is removed. Relations use `defineRelations`/`defineRelationsPart`, one table per file with a sibling relations part (AD13). **Pinned exact:** `drizzle-orm@1.0.0-rc.5`, `drizzle-kit@1.0.0-rc.5`, `typebox@1.4.3`, `elysia@2.0.0-rc.0`, `@elysia/eden@2.0.0-rc.0`.

**Amendment (2026-10-28, product decision).** TypeScript is **7.0.2** (the Go-native `tsc`), replacing the Stage 3 pin of 6.0.3. The pin had guarded against Elysia's optional TS peer pulling 7.x; every `typescript` dependent in the tree is an optional peer whose range admits 7, and nothing calls the removed JS compiler API (`tsc --noEmit`, `vp build`, `vp test` and `drizzle-kit generate` pass). New gate: `vp run typecheck`.

### D24. An offer can be chosen as soon as it arrives; late answers are recorded but can't change the choice (grill Q24)

The clinic needs a fast answer. Making the patient wait on a 4–15 s lender contradicts the case's premise.

| Option                                        | Verdict                                                   |
| --------------------------------------------- | --------------------------------------------------------- |
| Choose anytime; record late answers           | **Chosen**                                                |
| Choosing unlocks at all-settled or deadline   | Rejected. Dissent preserved: guarantees a full comparison |
| Choose anytime, with a warning + confirmation | Rejected: extra step                                      |

**Evidence.** A.

**Decision.** "Escolher" is enabled per offer on arrival. Choosing sets `chosen_offer_id` once and moves the consultation to `CHOSEN`. Pending attempts still settle and are stored. Re-choosing the same offer → 200 with the same body; a different offer after a choice → 409 (AD14).

**Amendment (2026-10-27, discovery).** Representation: a choice can happen while lenders are still quoting, so fan-out progress and choice are two persisted facts. They are `consultation.quote_status` (`QUOTING` → `SETTLED`) and `chosen_offer_id`/`chosen_at`. The public `journeyStatus` (`QUOTING | OFFERS | NO_OFFER | CHOSEN`) is derived from them at read time. "Moves to `CHOSEN`" means the derived status. Behaviour unchanged.

### D25. Four backoffice areas over existing tables; server-first lists; no SSR (grill Q25)

The user confirmed all four areas. Every metric derives from the business tables. Lists are server-first per user directive, and the front fetches everything over HTTP.

| Option                                                   | Verdict                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Money pipeline + lender health + explorer + abuse/limits | **Chosen** (user)                                                                      |
| Subset                                                   | Rejected by user. Dissent preserved: the largest UI surface, and it's a PDF bonus item |

**Evidence.** A.

**Decision.** Areas: (1) money pipeline (requested/approved/chosen volume over time, approval rate, approved/requested ratio, chosen volume per lender, average installment and total cost of chosen offers); (2) lender health (p50/p95 latency; approval/refusal/error/timeout rates; derived breaker state; kill switch + its log; queue backlog); (3) consultation explorer (list + detail with full patient data and decrypted CPF, frozen inputs, attempt timeline, offers, choice); (4) abuse & limits (limit hits, 429 counts, top CPFs/IPs in 24 h). No reporting tables. Every list declares an allow-list of filterable/sortable/searchable fields mapped to real columns (anything else → 422), a stable `id` tiebreaker and an index per allowed column. The CPF is never list-filterable, sortable or searchable, and list rows never decrypt. Exact CPF lookup goes via `cpf_hmac` in a POST body (AD19). **No SSR:** SSR off for every route; file routing, typed search params, client loaders, preloading and server routes hosting Elysia stay. The Eden client is browser-only with a same-origin base URL.

~~**Amendment (2026-10-27, discovery).** No-SSR switch, verified in the installed sources: `defaultSsr: false` in `createRouter` (`@tanstack/router-core/src/router.ts:448`).~~ Server routes (`server.handlers`) are matched before and independently of route rendering (`@tanstack/start-server-core/src/createStartHandler.ts:1186-1205`), so `/api/*` keeps working. The root `shellComponent` still emits the static HTML document (head, scripts); route content renders client-only. SPA prerender mode was not chosen: it adds a build-time prerender step, and server routes would be unaffected either way.

**Amendment (2026-10-28, implementation) — CHANGED: `defaultSsr` is not a `createRouter` option in TanStack Start 1.169** (`RouterConstructorOptions` omits it, TS2353). It's set on the Start instance: `src/start.ts` exports `startInstance = createStart(() => ({ defaultSsr: false }))`, which the Start plugin discovers. Verified on a Bun build: `/` returns the `<html lang="pt-BR">` shell with no route markup while `/api/health` answers 200. Also: `routeTree.gen.ts` must be generated by the Start plugin; `tsr generate` drops the `Register` augmentation.

### D26. Offset/limit pagination in one shared format (grill Q26)

Page numbers and totals are the familiar admin UX. One format makes "sort by any field" trivial.

| Option                                    | Verdict                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Offset/limit everywhere                   | **Chosen** (user)                                                                                                          |
| Keyset with an opaque cursor              | Rejected by user. Dissent preserved: the HTML says "keyset, nunca OFFSET" after a 9.32 GiB OOM; OFFSET degrades with depth |
| Keyset by default, offset for small lists | Rejected: two formats                                                                                                      |

**Evidence.** A.

**Decision.** Request `?page=&pageSize=&sort=field:dir&q=&<field filters>`; response `{ items, page, pageSize, total, totalPages }`. One TypeBox contract and one front table component serve every list.

### D27. The patient's address, looked up by CEP through our API (user request, 2026-10-28)

The user asked for a full address in step 1, right after the birthdate. The CEP comes first and is looked up on ViaCEP; the other fields appear only once the CEP resolved, prefilled.

| Option                                   | Verdict                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| In step 1, right after the birthdate     | **Chosen** (user)                                                                                                            |
| A separate "Endereço" step               | Rejected by user. Dissent preserved: step 1 becomes long                                                                     |
| Lookup through `GET /api/addresses/:cep` | **Chosen** (user): server timeout, error mapping, cache and a per-IP cap; the browser only talks to us; testable with a fake |
| Browser calls viacep.com.br directly     | Rejected by user: third-party dependency in the browser, no caching, E2E tied to the real service                            |

**Evidence.** A (user decisions); B for ViaCEP's response shapes (`erro: true`/`"true"`, HTTP 400 for a malformed CEP).

**Decision.** Request `address { cep, street, number, complement?, neighborhood, city, state }` (`src/lib/address`), required on create, part of the idempotency hash, stored normalised on the patient (last write wins, like the phone) in nullable columns: patients saved before this change have none. Never in public payloads (RF-502). The lookup answers 200/404 `CEP_NOT_FOUND`/503 `ADDRESS_LOOKUP_UNAVAILABLE`; when ViaCEP is unavailable the form reveals empty fields for manual entry, so ViaCEP is never on the submit path and the API doesn't cross-check the CEP against the city on submit. Lookups use the throttle with their own per-IP cap (`RATE_LIMIT_LOOKUP_IP_MAX`, default 120 per window: a clinic shares one IP) and a bounded in-process cache. Lookup rows appear in the throttle-events list but not in the abuse figures (RF-614), which stay create/requote only: every signup makes one or more lookups, so counting them would bury real abuse.

### D28. Design-system inputs only (user request, 2026-10-28)

**Decision.** No native `type="date"` inputs or `<select>` elements: dates use a shadcn-pattern date picker (masked `dd/mm/aaaa` input plus a `Popover` + `Calendar` with month/year dropdowns), choices use the shadcn `Select`. Values on the wire are unchanged (`YYYY-MM-DD`).

**Amendment (2026-10-28, user request).** The date picker is shadcn's base "Date Picker → Input" example as published (`InputGroup` + `InputGroupButton` + `Popover` + `Calendar`, registry primitives installed with the CLI), wrapped once in `src/components/ui/date-picker.tsx`; no custom calendar internals. Every reusable design-system piece lives in `src/components/ui/` (including the new `stepper.tsx`).

### D29. Route files: a directory for every parent with two or more nested routes (user rule, 2026-10-28)

**Decision.** A parent route with two or more nested routes uses TanStack directory routes (`cadastro/route.tsx` + `cadastro/paciente.tsx`…, `backoffice/route.tsx` + `backoffice/consultas/{index,$consultationId}.tsx`); a parent with a single nested route stays a flat `.` file (`api.$.ts`, `consultas.$consultationId.tsx`). URLs are unchanged. (First applied as "nested two or more levels deep"; corrected the same day to the user's intent: the count of nested routes, not depth.)

### D30. Signup form ergonomics (user request, 2026-10-28)

**Decision.** (a) Fields validate on blur and on submit (`Próximo`/send), never while typing: a multistep form shouldn't scold a half-typed value. (b) The stepper shows each step's semantic icon, marks the active step (`aria-current="step"`, highlighted tile) and completed steps (drawn check), with React Bits Stepper's motion (spring glider, direction-aware slide + fade, height animation; reduced motion respected) in this app's visual language. (c) An optional patient e-mail on the contact step (`src/lib/email`: WHATWG local part, dotted domain with a 2+ letter TLD, ≤ 254 chars; stored trimmed and lower-cased; last write wins, so a resubmission without it clears it; in the idempotency hash; never public). (d) Table search keeps its 400 ms debounce (Enter applies at once, CPF-shaped text never sent), now through `@tanstack/react-pacer` instead of a hand-rolled timer.

### D31. One local HTTPS address for dev and prod-parity (user request, 2026-10-28)

**Decision.** Caddy fronts both stacks at `https://parcela.localhost:8443` (`*.localhost` resolves to loopback everywhere; Caddy's internal issuer signs it). One local certificate authority ("parcela-mais-case dev"), kept in `.local/caddy` so `vp run prune` doesn't regenerate it, is shared by dev and local prod-parity (`CADDY_DATA`); a VPS deploy keeps its volume and ACME for its real `APP_DOMAIN`. `vp run up` installs trust in the user's store when missing (Windows `certutil -user`, macOS login keychain, Linux NSS user db + each Firefox profile): one OS confirmation per machine, silent afterwards. Firefox on Windows/macOS uses OS-store CAs added by users (Mozilla docs, Firefox ≥ 120). The dev server binds only an address the proxy needs (Windows: the WSL switch; macOS and Windows + Docker: loopback; Linux + Docker: `docker0`; Linux + rootless Podman: the default-route address, flagged by `doctor` because pasta never maps the host's loopback); the dev proxy publishes on loopback only. Dev Caddy trusts the client's `X-Forwarded-For` (`CADDY_TRUSTED_PROXIES=private_ranges`, as the bare dev server did) and marks itself `X-Parcela-Stack: dev`; production trusts none (RF-506). The documented dev backoffice password is unified to the one the tests use and printed by `up` (dev only, only when the configured hash verifies against it).

**Evidence.** A on Windows (live runs: trust prompt accepted once, health over verified TLS, HMR over `wss`, redirect `:8080 → :8443`, LAN/Tailscale refused, full E2E over the address); C for macOS/Linux (unit-tested plans only).

### D32. Signup navigation, review, and the offer screen (user request, 2026-10-28)

**Decision.** (a) A signup step is reachable when every earlier step is complete (its fields pass the form schema; step 1 also needs the CEP answered). Arriving on an unreachable step by reload, URL or history redirects with `replace` to the first incomplete step, without errors; values still aren't persisted (RF-107), so a reload starts over. (b) The stepper header jumps to any reachable step; the step being left is checked on the way, like "Próximo", so the next step is always clickable and a jump stops at the first incomplete step with its errors. (c) A fourth step, Revisão, renders the summary from the exact request object the submit sends (`toSignupRequest`), so what the user confirms is what is sent; only it submits. (d) Lenders get placeholder logos (fictional SVG marks, theme tokens `--lender-*`), and `LenderIdentity` (logo + name, name as the accessible text) is the one way a lender is shown, public and backoffice. (e) Offers are grouped per lender in collapsibles, all open; the sort orders rows within groups and groups by their best offer (`groupOffersByLender`, pure). (f) Choosing is final, so "Escolher" opens a confirmation dialog summarizing the offer; only "Confirmar escolha" sends; a failed confirm keeps the dialog open after the usual toast.

**Evidence.** A (E2E for each point, keyboard journey through the review and the dialog, browser checks in light and dark themes).

### Supporting decisions taken by the agent during the grill (vetoable)

From grill §3 (renamed AD*n* = grill §3 D*n*). Normative unless vetoed.

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Grade |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| AD1  | Scale `standard`; prototype gate not triggered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | B     |
| AD2  | Ops scripts in `scripts/ops/{doctor,up,prune,deploy}.ts` on Bun, exposed as uncached `package.json` scripts (`vp run <name>`)                                                                                                                                                                                                                                                                                                                                                                                                         | A     |
| AD3  | `doctor` checks container engine + compose provider, Bun version vs `devEngines`, env schema, DB reachability, pending drizzle/pg-boss migrations, free ports, and the rootless-Podman port floor. Read-only, local                                                                                                                                                                                                                                                                                                                   | B     |
| AD4  | Caddy with a static Caddyfile, fully qualified images, overwrites `X-Forwarded-For`/`X-Real-IP`, no buffering for `text/event-stream`, TLS host from env                                                                                                                                                                                                                                                                                                                                                                              | B     |
| AD5  | One-shot `migrate` service runs the drizzle migrations and the pg-boss schema; app/worker start pg-boss with `migrate: false`                                                                                                                                                                                                                                                                                                                                                                                                         | A     |
| AD6  | The worker is a separate Bun process from the same image, with a different entrypoint                                                                                                                                                                                                                                                                                                                                                                                                                                                 | B     |
| AD7  | Backoffice password hashed with scrypt via `node:crypto`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | A     |
| AD8  | CPF crypto details (see D16 and the explainer)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | A     |
| AD9  | Client IP stored only as `HMAC("ip:v1:" + ip)` in `request_throttle`, purged after the window                                                                                                                                                                                                                                                                                                                                                                                                                                         | B     |
| AD10 | Requote preconditions (see D21)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | B     |
| AD11 | Money: integer cents ~~(`bigint`)~~, rate `numeric(7,6)`, exact decimal Price, half-up to the cent, `total = installment × n`, the front only formats in pt-BR BRL                                                                                                                                                                                                                                                                                                                                                                    | B     |
|      | **Amendment (2026-10-27, discovery): CHANGED.** Cents columns use `bigint({ mode: "number" })`. Postgres type `bigint`; JS `number`, safe to 2^53 cents. Mode `"bigint"` fails through Elysia 2.0.0-rc.0: responses 500 ("JSON.stringify cannot serialize BigInt") and JSON request bodies get 422 (live probe). The rate stays `numeric(7,6)` in drizzle's default **string** mode, refined with a decimal pattern. Price is computed as an exact rational with `BigInt` in the pricing service, so float error never touches money. | A     |
| AD12 | `POST /api/consultations` is idempotent via a client `Idempotency-Key` generated on form mount: replay → original response; same key with a different body → 422                                                                                                                                                                                                                                                                                                                                                                      | B     |
| AD13 | One table per file; sibling `<table>.relations.ts` via `defineRelationsPart` for the relations originating at that table; parts combined in one index                                                                                                                                                                                                                                                                                                                                                                                 | B     |
| AD14 | Choose: set-once; same offer → 200 with the same body; a different offer → 409                                                                                                                                                                                                                                                                                                                                                                                                                                                        | B     |
| AD15 | UI in pt-BR; keyboard + screen reader support on Base UI primitives; lender status changes announced via `aria-live`                                                                                                                                                                                                                                                                                                                                                                                                                  | B     |
| AD16 | Structured JSON log per lender call (lender, attempt id, latency, outcome, reason) with PII redaction                                                                                                                                                                                                                                                                                                                                                                                                                                 | B     |
| AD17 | No offer expiry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | B     |
| AD18 | One global `deadline_at = created_at + 10 s`; each call's timeout = the remaining budget                                                                                                                                                                                                                                                                                                                                                                                                                                              | A     |
| AD19 | Backoffice CPF search goes in a POST body, never a query string                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | A     |
| AD20 | nitro targets the Bun preset; `vercel.json` and the Vercel add-on are removed                                                                                                                                                                                                                                                                                                                                                                                                                                                         | A     |

### Product decision recorded at Stage 2 (2026-10-27, product decision)

The full test pyramid ships, with **end-to-end tests written in the final build phase**. Once everything else is done, E2E tests cover the critical paths and a browser smoke test exercises them before delivery. Adds to D20; supersedes nothing. The E2E runner is Open question O4.

---

## Pre-existing defects in the blast radius

Found in discovery (2026-10-27). Each is fixed by the feature because the feature replaces the file.

| Defect                                                                | Evidence                                                                                                                                                                                                                          | Impact                                                                                                                            | Status                                                                                                                                                                                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/env.ts` reads server variables from `import.meta.env`            | `src/env.ts:23`; a Vite SSR build inlines unprefixed `import.meta.env.*` as `void 0`, with only `VITE_*` + mode keys present (vite-plus-core 1.3.0 / Vite 8.3.4 build, `node.js:21731-21738`, reproduced by the validation probe) | Every server env var reads as `undefined` in production; the module is also imported by nothing (`src/db/index.ts:5` bypasses it) | Open: replaced by a server env module on `process.env` + a client env module on `import.meta.env`                                                                                                                               |
| `vp check` fails on the untouched template: type error                | `drizzle.config.ts:6` TS2345, `dbCredentials.url: string \| undefined` (`vp lint`, 2026-10-27)                                                                                                                                    | The repo's own gate is red before any feature work                                                                                | **Fixed (2026-10-27, implementation)** in `f13a476`: fail fast when `DATABASE_URL` is missing. S0 still migrates the file to drizzle-kit 1.0.0-rc.5                                                                             |
| `vp check` fails on the untouched template: generated file formatting | `src/routeTree.gen.ts` reported by oxfmt (`vp check`, 2026-10-27)                                                                                                                                                                 | Same: the gate is red on generated code                                                                                           | **Partially fixed (2026-10-27, implementation):** the pre-commit hook formatted it in `bcc7b9e`, so `vp check` is green. Still open: exclude it from fmt/lint in `vite.config.ts` so regeneration can't turn the gate red again |

## Risks

| #   | Risk                                                                               | Severity           | Mitigation                                                                                                           |
| --- | ---------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| R1  | The VPS disk dies and every consultation and choice is lost (single disk, no PITR) | High               | Accepted for simulated data. `DATABASE_URL` swap to managed Postgres needs no code change. Reopens on real data (A2) |
| R2  | A Node-vs-Bun behaviour gap reaches production with no CI container smoke test     | Medium             | Walk the forced scenarios under `up --prod` before each runtime-sensitive deploy (A3, A7)                            |
| R3  | RC dependencies (drizzle 1.0 RC, Elysia 2 RC, Eden RC) break or change APIs        | Medium             | Exact version pins (D23); reopen trigger on a blocked feature                                                        |
| R4  | A spoofed client-IP header bypasses the per-IP cap                                 | High               | The proxy overwrites the header; the guard trusts only it; test with a forged header (A22)                           |
| R5  | A leaked capability link lets a third party choose the offer                       | Medium             | Accepted: choosing only records intent. Reopens if choosing submits to a lender (A13)                                |
| R6  | Keys and DB share the VPS disk, so host compromise exposes CPFs                    | High for real data | Accepted for simulation; separation pays off once the DB moves off-box (explainer §5)                                |
| R7  | Rollback means a minutes-long rebuild on 2 vCPU under pressure                     | Medium             | Accepted by the owner (D4); reopen trigger at > 5 min                                                                |
| R8  | OFFSET/`COUNT(*)` degrades as tables grow                                          | Low now            | Accepted by the owner (D26); measured reopen trigger at 500 ms                                                       |
| R9  | The TypeBox adapter maps form errors poorly (wrong field, English text)            | Medium             | Path mapping verified; pt-BR keyword table; CPF field test (A23)                                                     |
| R10 | Forced demo runs pollute breaker state                                             | Medium             | Breaker counts only `NORMAL` attempts (D11)                                                                          |
| R11 | A missed NOTIFY leaves a card stuck on "consultando"                               | Medium             | LISTEN before snapshot, 2 s re-read, lazy finalization (D9)                                                          |

---

## Open questions

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                | Needed by                               | Owner  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------ |
| O1  | Public hostname / TLS domain for the VPS (provisional: `APP_DOMAIN` env; unset → HTTP on the IP). _Local stacks use `parcela.localhost` with a local CA since 2026-10-28 (D31); the VPS question is unchanged_                                                                                                                                                                                                          | Before the first VPS deploy with TLS    | Micael |
| O2  | Rate-limit thresholds (provisional: 5 consultations / patient / 24 h; 30 / client IP / hour; env-configurable)                                                                                                                                                                                                                                                                                                          | Before the D22 guard is considered done | Micael |
| O3  | VPS OS and Podman mode (provisional: rootless Podman on systemd Linux; `doctor` checks the port floor)                                                                                                                                                                                                                                                                                                                  | Before the first VPS deploy             | Micael |
| O4  | ~~E2E runner for the final-phase E2E suite (e.g. Playwright standalone vs Vitest browser mode with the Playwright provider under `vp test`)~~ **Closed (2026-10-28, implementation):** Playwright Test standalone (`test/e2e/*.spec.ts`, `vp run e2e`), because Vitest browser mode runs tests inside a page iframe and can't drive full reloads of the real app, which RF-207 and RF-406 need. Lead decision, vetoable | Before the E2E phase starts             | Micael |
| O5  | (Stage 5 audit Q-1) Under rootless Podman, does Caddy see the real client IP? With a port forwarder that hides it (slirp4netns), every client counts as one IP and the RF-505 cap becomes global. Pasta (Podman 5+ default) preserves it. Decide the VPS network mode with O3 and verify the counted IP there                                                                                                           | Before the first VPS deploy             | Micael |
| O6  | (audit Q-4) RF-408 "identical body": re-choosing returns the current view, so while lenders are still quoting the body can differ (new attempts/offers); the choice itself is identical. Is "same choice" the intended reading?                                                                                                                                                                                         | Next PRD revision                       | Micael |
| O7  | (audit Q-6) The lender-health queue backlog comes from pg-boss stats that can lag up to 60 s. Acceptable for RF-610?                                                                                                                                                                                                                                                                                                    | Next PRD revision                       | Micael |
| O8  | (audit Q-7) Lender-health rates (RF-606) include forced-scenario attempts, so demo runs inflate Delta's error rate while the breaker ignores them. Exclude forced attempts, or show them separately?                                                                                                                                                                                                                    | Next PRD revision                       | Micael |
| O9  | (audit A1 residue) RF-302 vs RF-502: the public view no longer carries lender hints, but the suggested amount itself equals income × 10 in NORMAL when Alfa's is the best usable hint (Beta/Delta/Gama all without an offer). Keep suggesting it (useful, reveals income to a link holder) or round it/hide it?                                                                                                         | Next PRD revision                       | Micael |
| O10 | (audit QN1) Delta trips its breaker on ordinary `NORMAL` traffic ≈ 7 % of 20-call windows (see the D11 correction). Raise the threshold, stop counting timeouts, or bring Delta's simulated latency inside the deadline?                                                                                                                                                                                                | Next PRD revision                       | Micael |

**Discovery inputs for Stage 3** (research, not decisions): the exact TanStack Start switch that disables SSR app-wide; `app.handle`/`treaty(app)` under `vp test` specifically (verified on plain Node only); the adapter's error mapping under TanStack Form; whether `defineRelationsPart` merges parts built from table subsets (AD13).

---

## Outcome

_Pending: filled when the decision is ratified and as the target repo delivers (Stages 4–5)._
