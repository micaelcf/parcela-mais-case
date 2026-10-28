# Grill decisions — pre-approval-journey (2026-10-27)

> **This document wins.** Wherever the RFC or PRD written from it later disagree, this record is
> the rationale source of truth until a decision here is explicitly superseded.

- **Altitude:** product (Stage 1)
- **Scale:** `standard` — touches money, new persisted schema, new dependencies (Elysia, Eden, Base UI/shadcn), files not nameable up front. Gives up: cross-repo contract drift detection (single repo, nothing to drift from).
- **Prototype gate:** not triggered — multi-step form, status cards, offer list, admin tables + KPI cards are known patterns.
- **Sources:** `C:\Users\Micael\Downloads\Case Técnico · Dev Full Stack Sênior.pdf` (the "PDF"), `C:\Users\Micael\Projects\learning-tech\jornada-credito-parcela-mais.html` (the "HTML"), template repo at commit-time state.

## 1. Closed decisions

### Q1 — Where does the journey end?

**Decision.** Stages 1–3 only (signup → parallel pre-approval → offers → choice persisted as an immutable, idempotent snapshot). The backoffice is a pipeline/risk view (consultations, lender health, offered/approved/chosen volume). No ledger.

**Why.**

1. The hard problems (fan-out, 10 s deadline, partial failure, idempotent choice) all sit in stages 1–3 (PDF p.1–2).
2. Stages 1–3 don't move any money, so a double-entry ledger would have nothing real to record (HTML `#assinatura` ledger is posted on disbursement, stage 7).
3. Stages 5–7 bring three more fake counterparties and need a durable scheduler that Vercel doesn't provide.

**Evidence.** A — PDF p.2 "Ao escolher uma oferta, a escolha é salva no backend e a tela mostra a confirmação"; HTML `jornada-credito-parcela-mais.html:305-313` (ledger tied to disbursement).
**Dissent.** A real ledger is the strongest way to show that the money always balances, and the user asked for a dashboard of "everything that touches money". Scope A turns that into a pipeline view.
**Riskiest assumption.** A pipeline/lender-health dashboard is enough to cover the "financial dashboard" ambition for now.
**Test.** Sketch the dashboard's KPI list (volume offered/approved/chosen, approval rate per lender, p95 latency, error/timeout rate) and confirm with the user that it reads as useful.
**Would reopen if.** A requirement appears for proposal submission, lender decision callbacks, or disbursement — any event where money actually changes hands.
**Supersedes.** HTML 7-stage journey as the build scope (it stays as reference architecture).

### Q2 — Who runs the 4-lender fan-out after the POST, given Vercel has no workers?

**Decision.** PIVOT — this is the wrong question. Vercel's lack of persistent processes is the constraint itself, so the real question is the deploy target.

**Why.** 1. The user proposed pg-boss. pg-boss consumers are polling `work()` loops, and scheduling/maintenance need "at least one instance running" (pgboss.io/api/workers, /api/scheduling). Vercel functions are request-scoped (vercel.com/docs/functions/limitations), so pg-boss on Vercel degrades to a job table drained inside `waitUntil`, which duplicates attempt state for no gain.
**Evidence.** A — pgboss.io docs; Vercel limits docs; HTML `jornada-credito-parcela-mais.html:595-600,680-699` (reference architecture assumes SKIP LOCKED workers + LISTEN/NOTIFY).
**Reframed as.** Q2b

### Q2b — Deploy target, once a VPS is on the table?

**Decision.** Single VPS (2 vCPU / 6 GB / 120 GB NVMe, 120-day trial). One compose file that works with both Podman and Docker runs everything from a single command: reverse proxy + Bun app + Bun worker + Postgres. Bun is the runtime for every process. Postgres is local by default, and swapping `DATABASE_URL` points it at a managed/cloud Postgres with no code change.

**Why.**

1. Persistent processes make the HTML reference architecture buildable: pg-boss workers, `SKIP LOCKED`, `LISTEN/NOTIFY`, SSE with no function time limit.
2. The box is far above the I/O-bound workload: four timers plus four writes per consultation.
3. One command means local runs match production, and it satisfies the PDF's "idealmente com um único comando (Docker Compose é bem-vindo)".
4. The user runs Podman, so the compose file must not depend on Docker-only features.

**Evidence.** B — capacity is reasoned from the workload shape, not load-tested; the Podman requirement is the user's statement.
**Dissent.** Managed Postgres (option B) gives PITR backups and survives the box dying or the trial ending. With all-in-one, the single disk is the single point of data loss for every consultation and chosen offer.
**Riskiest assumption.** Losing the VPS disk is acceptable until `DATABASE_URL` is moved to a managed provider.
**Test.** `podman compose up` and `docker compose up` both bring the stack up healthy from a clean clone with one command.
**Would reopen if.** Real patient data is stored, the trial ends with no paid continuation, or availability needs exceed what a single host can give.
**Supersedes.** User brief "easy to deploy in Vercel"; `vercel.json` (`framework: tanstack-start`) and the nitro Vercel target become obsolete.

### Q3 — How far does "everything in bun" reach?

**Decision.** Bun is the package manager and the runtime of every container process (app, worker, ops scripts). `vp dev` and `vp test` stay on vp's supported Node runtime. Code under `src/` uses only Web standards and `node:*` APIs, with no `Bun.*` globals, so it behaves the same on both. Drizzle stays on `pg` (node-postgres) and shares one pool with pg-boss through its `db.executeSql` adapter. No CI container smoke test for now.

**Why.**

1. `vp env` manages one Node.js runtime; Bun is only a package-manager family there (`node_modules/vite-plus/docs/guide/env.md:3`). Forcing `bunx --bun vp …` leaves the documented path.
2. pg-boss hard-depends on `pg` and offers a bring-your-own `executeSql`, so there is one driver and one pool instead of `bun-sql` plus `pg`.
3. Elysia mounts through `app.fetch(request)`, which is runtime-agnostic (next.elysiajs.com/integrations/tanstack-start).

**Evidence.** A — vite-plus docs `env.md:3`; pg-boss `package.json` (`dependencies.pg`, `engines.node >=22.12`); pgboss.io/api/constructor `db` option.
**Dissent.** Dev/test on Node and production on Bun 1.4 (a Rust rewrite with breaking changes, per Vercel's Bun docs) is two runtimes, and with no CI smoke test nothing checks the gap before deploy.
**Riskiest assumption.** Node-passing code behaves identically on Bun 1.4.x (`pg` sockets, timers, `AbortSignal.timeout`, streaming responses).
**Test.** Run `vp run up` locally (Bun containers) and exercise all four forced scenarios once before the first deploy.
**Would reopen if.** Any defect reproduces on Bun but not on Node (or the reverse), or vp documents Bun runtime support.
**Supersedes.** Template `src/db/index.ts:1` stays on `drizzle-orm/node-postgres` (confirmed, not replaced by `bun-sql`).

> **User directive (mid-session, priority):** the project MUST ship `doctor`, `up`, `prune` and `deploy` commands. None of them collides with a `vp` built-in (`vp help`: create, migrate, dev, build, test, lint, fmt, check, pack, run, exec, preview, cache, config, hooks, staged, toolchain, install), so they are invoked as `vp run <name>`. Their shape is grilled in Q4+.

### Q4 — What does `vp run deploy` ship to the VPS, and how do you roll back?

**Decision.** Build on the box. `deploy` = SSH → `git fetch` + checkout `<ref>` → `compose build` → one-shot `migrate` service (must exit 0) → `compose up -d` app + worker → health check. No registry. Rollback = deploy a previous ref.

**Why.**

1. No registry credentials or image transport to manage; the box already has headroom (Q2b).
2. `git checkout <ref>` makes the deployed version a git fact, readable on the box.
3. A gated `migrate` service means a failed migration never leaves a half-started app.

**Evidence.** B — reasoning from Q2b capacity; no measured build time on the VPS yet.
**Dissent.** A SHA-tagged image in a registry gives immutable artifacts and a no-rebuild rollback in seconds. Here, rollback is a rebuild taking minutes, under pressure, and the build competes with live traffic on 2 vCPU.
**Riskiest assumption.** A full `compose build` on the VPS finishes fast enough (minutes, not tens of minutes) without degrading the running app.
**Test.** Time a cold `compose build` on the VPS while hitting `/api/health` in a loop; check p95 latency and build duration.
**Would reopen if.** A build on the box takes > 5 min, causes visible latency/OOM in the running app, or a rollback is ever needed faster than a rebuild.

### Q5 — What may `vp run prune` destroy, and where?

**Decision.** `prune` is a local dev reset only: `compose down -v` (including the local DB volume) plus this project's image and build-cache cleanup. It has no remote mode. VPS disk reclamation belongs to `deploy`: after a healthy deploy, it removes this project's old images and build cache.

**Why.**

1. Prod data can't be destroyed by `prune` because `prune` can't reach prod.
2. Cleanup is tied to the only event that creates garbage on the box (a build, per Q4).

**Evidence.** B — compose/engine prune semantics (`down -v` removes named volumes; Podman and Docker prune scopes differ).
**Dissent.** If deploys fail midway, post-deploy cleanup never runs and orphaned build layers pile up on the 120 GB disk with no manual command to reclaim them.
**Riskiest assumption.** Failed deploys are rare enough that disk is reclaimed by the next successful one.
**Test.** Run three deploys with a deliberately failing health check in the middle; compare `podman system df` before/after.
**Would reopen if.** VPS disk usage crosses 70 % or a deploy fails on "no space left on device".

> **User directive (mid-session, priority):** "no remote connections in scripts". Ops scripts never open SSH or any session to another host. Consequences, applied now:
>
> - **Q4 mechanism superseded:** `deploy` no longer SSHes. It runs _on the host being deployed_ (the operator connects to the VPS manually), and does build → gated `migrate` → `up -d` → health check against localhost → post-deploy image/cache cleanup. Build-on-the-box and rollback-by-earlier-ref stand.
> - **Q5 unchanged in effect:** cleanup inside `deploy` is local to the host it runs on.
> - `doctor` has no remote mode; on the VPS you run it there.

### Q6 — May `deploy` `git fetch` from origin?

**Decision.** No. `deploy` builds the current checkout only. It refuses a dirty working tree, stamps `git rev-parse HEAD` into the image and the health endpoint, then migrates, starts, health-checks localhost and cleans up. The operator runs `git pull`/`git checkout <sha>` manually. Rollback = `git checkout <old-sha> && vp run deploy`.

**Why.**

1. It follows the user's "no remote connections in scripts" literally.
2. The deployed version is exactly the visible HEAD, so the running SHA is checkable from `/api/health`.

**Evidence.** A — user directive; B — determinism reasoning.
**Dissent.** A single `vp run deploy <ref>` that fetches itself is one command instead of two, and removes the "forgot to pull" failure.
**Riskiest assumption.** The operator always pulls the intended ref before deploying.
**Test.** Deploy, then compare `/api/health` `sha` with `git rev-parse origin/main` on the box.
**Would reopen if.** A deploy ships a stale SHA because the pull was forgotten.
**Supersedes.** Q4's `git fetch` + checkout step.

### Q7 — What does `vp run up` bring up?

**Decision.** One entry point with two modes. `vp run up` (default) = dev mode: Postgres container + gated migrate + `vp dev` (HMR, Node) + worker in watch mode. `vp run up --prod` = full prod-parity stack: Bun containers for app + worker + proxy + Postgres, gated migrate, waits for health, prints the URL. `deploy` = `up --prod` + dirty-tree guard + SHA stamp + post-deploy cleanup.

**Why.**

1. The default is the everyday loop (user's choice: "first dev").
2. One command satisfies the PDF's one-command run (`up --prod`) and day-to-day dev (`up`).
3. `deploy` reuses `up --prod` instead of building a second lifecycle.

**Evidence.** A — user decision.
**Dissent.** Prod parity is opt-in behind a flag, so the Bun containers (Q3's only Node↔Bun check) get run less often than with a parity default; one script also carries two lifecycles (foreground HMR vs detached containers).
**Riskiest assumption.** `up --prod` gets run locally before each deploy that changes runtime-sensitive code.
**Test.** Before the first deploy, run `vp run up --prod` and walk all four forced scenarios.
**Would reopen if.** A defect first shows up on the VPS that `up --prod` would have caught locally.

### Q8 — Who executes the lender calls, and what does pg-boss own vs our tables?

**Decision.** `POST` runs one transaction: insert the consultation + 4 `PENDING` `lender_attempt` rows + `deadline_at`, and pg-boss-send (via the `db` option, in the same TX) one job on each lender's queue plus one `consultation.finalize` job with `startAfter = deadline_at`. The worker process calls the lender through its port, with timeout = `deadline_at − now`, and records the result with a guarded `UPDATE … WHERE status = 'PENDING'`. The finalizer marks remaining attempts `UNAVAILABLE` and closes the consultation; reads lazily finalize past `deadline_at` as a backstop. `lender_attempt` is the business source of truth; pg-boss owns delivery only.

**Why.**

1. Transactional send makes the commit the outbox: a job exists if and only if the consultation committed (pgboss.io/api/adapters).
2. One queue per lender is a bulkhead: Delta's 4–15 s calls can't eat Alfa/Beta/Gama capacity, and queue stats give per-lender metrics.
3. Guarded updates + finalizer + lazy read finalization give exactly-once terminal state even if the worker dies mid-call.

**Evidence.** A — pgboss.io/api/adapters, /api/workers (transactional send, Drizzle adapter, `useListenNotify`); PDF p.2–3 (lender latency ranges, 10 s deadline).
**Dissent.** In-process fan-out (B) has no queue pickup latency and fewer parts; with a 10 s ceiling, durable delivery buys little beyond what the finalizer already guarantees.
**Riskiest assumption.** Queue pickup latency with LISTEN/NOTIFY stays in the low milliseconds, so Alfa (0.5–1.5 s) still feels instant.
**Test.** Log `picked_at − created_at` per attempt across 100 consultations under `up --prod`; p95 should be < 100 ms.
**Would reopen if.** p95 pickup latency > 250 ms, or LISTEN/NOTIFY can't be held (e.g. `DATABASE_URL` moved to a transaction-mode pooler).

### Q9 — How do lender statuses reach the screen?

**Decision.** SSE at `GET /api/consultations/:id/events`. Each connection first emits a full snapshot read from the DB (lazily finalizing past `deadline_at`). After that, every `pg_notify` for that consultation id (sent by the worker inside its guarded UPDATE's transaction) triggers a re-read and a fresh full snapshot. The stream closes when the consultation is terminal. The client reconnects automatically and always gets a fresh snapshot. No deltas, no event table.

**Why.**

1. NOTIFY is lossy; making it a "re-read" hint means a dropped notification or a reconnect costs latency, never correctness.
2. Keeps the HTML principle "o resultado mora no banco; o transporte só avisa" (`jornada-credito-parcela-mais.html:245`).
3. Snapshot-on-connect gives resume-after-reload (PDF bonus) without a separate code path.

**Evidence.** B — Postgres NOTIFY semantics; Elysia generator SSE + Eden async-iterable support from docs, not yet exercised in this repo.
**Dissent.** Polling (~700 ms) is stateless, needs no LISTEN connection, works behind any proxy, and the extra lag is invisible inside a ≤10 s wait.
**Riskiest assumption.** The reverse proxy and Eden pass SSE through unbuffered and typed.
**Test.** Under `up --prod`, `curl -N` the events endpoint through the proxy and confirm snapshots arrive as each lender settles, not all at the end.
**Would reopen if.** The proxy buffers `text/event-stream`, Eden can't type the stream, or the LISTEN connection proves unstable.

**Amendment (post-review, agent).** Handler ordering is part of the decision: `LISTEN consultation_<id>` **before** reading the snapshot. A NOTIFY that fires between the snapshot and the LISTEN would otherwise be lost, leaving a card stuck on "consultando". As a backstop, the handler re-reads every 2 s while the consultation is non-terminal (the read also lazily finalizes). `pg_notify` runs in the same transaction as the worker's guarded UPDATE, so delivery happens only after commit and the re-read never sees stale rows.

### Q10 — Do we retry a failed lender call?

**Decision.** No. One call per attempt; pg-boss `retryLimit: 0` on lender queues. A 5xx, network error or timeout makes the attempt `UNAVAILABLE` with a typed reason (`LENDER_ERROR`, `TIMEOUT`, …). The lender port's error type carries a `retryable` flag so an integration with a guaranteed-idempotent contract can opt in later without core changes.

**Why.**

1. Delta answers in 4–15 s; a retry after a failure almost never fits in the 10 s budget (PDF p.3).
2. A real pre-approval is a credit inquiry; a duplicate can register twice against the patient at the bureau/SCR.
3. Keeps the forced "Delta falha" scenario deterministic.

**Evidence.** A — PDF lender table; B — duplicate-inquiry harm is domain reasoning, not verified against a specific lender contract.
**Dissent.** A single budget-aware retry would recover some of Delta's 30 % failures and show the patient one more offer.
**Riskiest assumption.** Losing ~30 % of Delta answers to transient 500s is acceptable product-wise.
**Test.** Run 200 normal-mode consultations; check Delta's UNAVAILABLE share is ~30 % and that no other lender is affected.
**Would reopen if.** A lender contract documents idempotent pre-approval with a client key, or product says the lost-offer rate matters more than duplicate inquiries.

### Q11 — Circuit breaker for a lender that's down hard?

**Decision.** Both, with the manual switch taking precedence. (1) Manual: a per-lender kill switch in the backoffice; disabled → the attempt is settled `UNAVAILABLE(DISABLED)` without a call. (2) Automatic: before calling, the worker derives breaker state from that lender's last 20 settled attempts within 5 min; ≥ 16 failures → `OPEN` → `UNAVAILABLE(CIRCUIT_OPEN)` without a call; after 30 s one probe call is allowed (half-open). Breaker state is computed, never stored. The backoffice sits behind simple username/password auth (shape in Q12).

**Why.**

1. During an outage, an open breaker lets the card show "indisponível" immediately and lets the consultation close early once the others settle.
2. 16/20 makes false trips on Delta's normal 30 % noise negligible (P = 5.6×10⁻⁶ vs 0.150 for 5/10, binomial).
3. Deriving state from `lender_attempt` keeps one source of truth and survives worker restarts.
4. The manual switch covers what the breaker can't see coming (a lender announcing maintenance).

**Evidence.** A — binomial computation; B — the threshold values are judgment and untuned against real traffic.
**Dissent.** Two mechanisms plus precedence rules for a simulation that only has one forced outage scenario; a single manual switch would be simpler and more legible.
**Riskiest assumption.** Simulation traffic fills the 20-attempt window often enough for the automatic breaker to ever engage.
**Test.** Force "Delta falha" for 20 consultations, then confirm the 21st settles Delta as `CIRCUIT_OPEN` within ms, and a probe goes through after 30 s.
**Would reopen if.** False trips are observed in normal mode, or the breaker never engages outside the forced scenario.

**Amendment (post-review, agent).** The breaker window counts **only `NORMAL`-scenario attempts** (Q18). Forced-scenario attempts never count toward opening it and never act as half-open probes, so demo runs of "Delta falha" can't open the breaker for real traffic. The test above is replaced by: (a) unit tests of the pure breaker derivation over attempt lists (boundaries 15/20 vs 16/20, the 5 min window, the 30 s half-open, forced attempts ignored); (b) an integration test where the simulator's Delta failure rate is configured to 100 % for `NORMAL` traffic (simulator config, not a forced scenario) and the 21st consultation settles `CIRCUIT_OPEN`. Manual switch precedence is unchanged.

### Q12 — Shape of the "representative" backoffice auth?

**Decision.** A single operator from env: `BACKOFFICE_USERNAME` + `BACKOFFICE_PASSWORD_HASH` (scrypt via `node:crypto`). A login form issues an HMAC-signed session cookie (httpOnly, Secure, SameSite=Lax, 8 h). An Elysia guard enforces it on `/api/backoffice/*` and a route guard on `/backoffice/*`. Every kill-switch change is appended to an immutable table with `actor = username`.

**Why.**

1. The user wants auth to be representative, not a user-management feature.
2. Authorization is enforced server-side on every backoffice API route, not just in hidden UI.
3. The kill switch changes patient outcomes, so who flipped it is recorded.

**Evidence.** A — user decision; B — the cookie attributes follow standard practice and the HTML's auth card (`jornada-credito-parcela-mais.html:343`).
**Dissent.** A users table with DB sessions gives per-person audit and revocation without rotating the signing secret.
**Riskiest assumption.** One shared operator identity is enough for audit purposes.
**Test.** Call `/api/backoffice/*` without the cookie or with a tampered cookie, and with an expired one; all must return 401.
**Would reopen if.** A second operator needs access, or a session must be revoked without logging everyone out.

### Q13 — How is a consultation reachable on the public journey, and what does that handle expose?

**Decision.** A capability URL: `/consultas/$consultationId` (UUIDv7). Public GET/SSE/choose responses carry status, lender attempts, offers, the chosen offer, the requested amount, the patient's first name and a masked CPF (`***.456.789-**`) only. Full PII (name, CPF, birthdate, phone, income) is readable only in the authenticated backoffice.

**Why.**

1. Resume works across reloads and devices with no session machinery (PDF bonus).
2. A leaked or forwarded link exposes an amount and offers, not a CPF (HTML LGPD card, `jornada-credito-parcela-mais.html:234`).
3. UUIDv7's 74 random bits make enumeration infeasible.

**Evidence.** A — HTML `:234`; B — UUIDv7 entropy per RFC 9562.
**Dissent.** A browser-bound secret cookie stops a leaked link from being used to choose an offer for someone else.
**Riskiest assumption.** Anyone holding the link is entitled to choose the offer.
**Test.** Hit the public endpoints for a consultation and grep the JSON for any CPF digits, the birthdate, phone and income; none may appear. The public read path must not load the encryption key.
**Would reopen if.** Choosing an offer gains a consequence beyond recording intent (e.g. submission to a lender, stage 4).

**Amendment (post-review, agent, vetoable).** Public responses carry **no CPF at all**, not even the mask. The mask `***.456.789-**` reveals 6 of the 9 base digits (C9), and showing it would force decryption on the unauthenticated read path. Public payloads carry the patient's first name only. Consequence: the encryption key is used only in the authenticated backoffice detail view. The `PII-free public responses` choice the user made is unchanged; only the agent-proposed mask detail is removed.

### Q14 — Does the signup form survive a page reload before it's submitted?

**Decision.** No. One TanStack Form instance spans all signup steps, with state living above the step routes, so back/forward between steps loses nothing. A reload before submit restarts the form; after submit, the consultation URL (Q13) resumes everything.

**Why.**

1. Covers the PDF's hard requirement ("nada se perde se a pessoa voltar um passo").
2. Keeps PII out of browser storage (HTML `:234`) and out of the DB until the patient submits.

**Evidence.** A — PDF p.1; HTML `jornada-credito-parcela-mais.html:234`.
**Dissent.** An accidental reload or crash mid-form loses everything typed, with the patient sitting in front of the clinic.
**Riskiest assumption.** Mid-form reloads are rare enough not to matter.
**Test.** Fill step 1–2, go back, go forward: all values intact. Reload: form empty, nothing in Web Storage.
**Would reopen if.** Clinic feedback reports lost drafts as a real pain.

### Q15 — Is the patient an entity, and what does a consultation freeze?

**Decision.** `patient` is unique on CPF and holds identity/contact (upserted on submit, last write wins for contact fields). `consultation` references `patient` and freezes the decision inputs: monthly income, treatment amount, birthdate and age at submission. Each consultation is standalone: no `retry_of_consultation_id` and no link between consultations. Many consultations per patient are normal.

**Why.**

1. Lender rules read income/age/amount at call time (PDF p.2–3); freezing them keeps every past decision explainable from its own row.
2. A CPF-keyed patient lets the backoffice group a person's consultations without a relationship between consultations.
3. The user rejected a retry link: "one consultation, one register".

**Evidence.** A — PDF lender table; user decision.
**Dissent.** A retry link would let the dashboard measure how often "try a smaller amount" converts; without it, that funnel can only be inferred from same-patient consultations close in time.
**Riskiest assumption.** "Last write wins" on contact fields is acceptable (a later submission overwrites the phone used earlier).
**Test.** Submit twice with the same CPF and a different phone/income; check one patient row, two consultations, each consultation's frozen income intact.
**Would reopen if.** The product wants to measure the smaller-amount retry funnel, or contact history must be kept.

### Q16 — How is PII stored at rest?

**Decision.** Encrypt the CPF only: `patient.cpf_ciphertext` (AES-256-GCM in the app via `node:crypto`, with a key id per row) plus `patient.cpf_hmac` (HMAC-SHA256, unique, used for lookup/upsert). Name, birthdate, phone and income stay plain. Keys come from env (`PII_ENCRYPTION_KEY`, `PII_HMAC_KEY`).

**Why.**

1. CPF is the identifier that links a person to bureaus and fraud; a leaked dump should not be a CPF list.
2. Business numbers stay SQL-aggregatable for the dashboard.
3. Follows the HTML's guidance: cipher in the app, HMAC for lookup (`jornada-credito-parcela-mais.html:425`).

**Evidence.** A — HTML `:425`; B — the threat model (DB-only leak once `DATABASE_URL` points to a managed provider).
**Dissent.** A leaked dump still exposes names, phones, birthdates and incomes; encrypting all PII (B) closes that at the cost of SQL aggregation.
**Riskiest assumption.** The encryption key never lives in the same place as the DB dump (env on the app host, not in the DB or its backups).
**Test.** `SELECT * FROM patient` shows no 11-digit CPF; upserting the same CPF twice hits the same row through `cpf_hmac`.
**Would reopen if.** Real patient data is stored, or a compliance review requires all direct identifiers encrypted.

### Q17 — Are installment offers persisted rows, or computed on read?

**Decision.** Immutable `offer` rows, one per term, inserted in the same transaction that settles an attempt as `APPROVED`: `approved_cents`, `monthly_rate`, `term_months`, `installment_cents`, `total_cents`. Rows are never updated. The choice is `consultation.chosen_offer_id`, a guarded set-once FK. The pricing logic (Tabela Price, rounding, offer construction) lives in the **pricing domain service** of its feature module, the one place that rule exists. The worker is a thin adapter: it receives the job, calls the lender through its port, and hands the result to the domain service. It holds no business rules.

**Why.**

1. What the patient saw and what they chose are the same row by construction; sorting by installment/total is SQL (PDF p.2).
2. A later formula fix can't rewrite past consultations.
3. User rule: business logic and important rules are centralized in one module/service per feature. Entry points (HTTP routes, queue workers) only translate and delegate.

**Evidence.** A — PDF p.2 (per-term installment, total, sorting, persisted choice); HTML `jornada-credito-parcela-mais.html:251-271` (front displays, never calculates; immutable snapshot); user directive.
**Dissent.** Storing only the lender's answer and computing on read keeps one fewer table and lets a pricing fix apply everywhere.
**Riskiest assumption.** The same pricing service is the only code path that produces `installment_cents`/`total_cents` (no second calculation in the front or the worker).
**Test.** Grep for the Price formula; exactly one implementation exists, under the pricing service, and the worker imports the service, not the formula.
**Would reopen if.** Offers need to be re-priced after creation (e.g. rate changes before choice), or offer validity/expiry is introduced.

> **User directive (mid-session):** business logic and important rules live centralized in one domain service per feature module; workers, HTTP routes and SSE handlers are thin entry points that call those services.

### Q18 — How does someone force one of the four PDF outcomes instead of the random default?

**Decision.** `consultation.simulation_scenario` enum: `NORMAL` (default, random behaviour per PDF), `ALL_APPROVE`, `DELTA_FAILS`, `DELTA_TIMES_OUT`, `NONE_APPROVE`. It's carried in each lender job payload and read only by the simulated lender integrations. When `SIMULATION_CONTROLS=true`, the signup form shows a scenario picker; when the flag is off, the picker isn't rendered and the API rejects any value other than `NORMAL`. The backoffice shows each consultation's scenario.

**Why.**

1. The PDF requires forcing each of the four outcomes for a live demo (PDF p.3).
2. Per-consultation state is concurrency-safe: simultaneous users don't affect each other.
3. Stored on the row, so a forced failure is never mistaken for a real one later.

**Evidence.** A — PDF p.3; user decision after clarification.
**Dissent.** A simulation-only column in the core consultation schema leaks a test concern into the domain model; a header or global switch would keep it out of the schema.
**Riskiest assumption.** The env flag is reliably off wherever real lenders would be wired.
**Test.** With `SIMULATION_CONTROLS=false`, POST a consultation with `DELTA_FAILS` and expect 422; with it on, each scenario produces its outcome 20/20 times.
**Would reopen if.** A real lender integration replaces a simulated one (the scenario must then be ignored or rejected for that lender).

### Q19 — Where does the fake lender stop and our adapter start?

**Decision.** The backend mounts a lender simulator as its own Elysia plugin at `/api/simulator/lenders/{alfa|beta|gama|delta}/…`. Each lender has a deliberately different request/response JSON contract and the PDF's behaviour (latency range, rules, Delta's 500s, forced scenarios from Q18). Real HTTP adapters, one per lender, implement the common lender port: `fetch` with an `AbortSignal` (timeout = `deadline_at − now`), status/error handling, and translation into our canonical attempt result. Adapters take an injected `fetch`. At runtime that's global `fetch` against the configured base URL; in tests it's `(req) => simulator.handle(req)`, following Elysia's unit-test pattern (`app.handle(new Request(…))`, Eden `treaty(app)`), so adapter tests exercise real Request/Response semantics without opening a port.

**Why.**

1. The port/adapter boundary becomes real code: the HTTP call, status codes, aborts and per-lender mapping all exist. Going live = new base URL + mapper fix.
2. Satisfies "rodam dentro do seu backend" (PDF p.3) while keeping the simulator unmistakably external to the domain.
3. Elysia's `handle(Request)` makes HTTP-level tests cheap and port-free (next.elysiajs.com/patterns/unit-test).

**Evidence.** A — PDF p.3; Elysia unit-test docs; **Node smoke run (2026-10-27)**: `elysia@2.0.0-rc.0`, `@elysia/eden@2.0.0-rc.0`, `drizzle-orm@1.0.0-rc.5` (`drizzle-orm/typebox`) and `typebox@1.4.3` under Node v25.9.0 — `app.handle` returned 200 for a valid body and 422 for an invalid one, and `treaty(app)` returned 200 with typed data. Test files import from `vitest`, not `bun:test`. Elysia 2 route signature is `(path, hook, handler)`; the 1.x order throws at registration.
**Dissent.** In-process fake adapters are simpler, faster and fully deterministic, and the PDF doesn't ask for an HTTP boundary.
**Riskiest assumption.** The worker → app HTTP hop is reliable enough that simulator unavailability is never confused with lender unavailability.
**Test.** Stop the app container while the worker runs; attempts must settle `UNAVAILABLE` with a reason distinguishable from a lender 500.
**Would reopen if.** The hop measurably eats into the 10 s budget, or `vp test` (Vitest) behaves differently from the plain-Node smoke run.

### Q20 — What database do integration tests run against, and how is test data created?

**Decision.** Integration tests run against the real Postgres from the compose service: a throwaway database per run (`test_<random>`), with the real drizzle migrations and the pg-boss schema applied, dropped afterwards. Test data is created **only through the real implemented code**: repositories, domain services, the Elysia app via `handle`/Eden. There are no test-only factories or inline row builders. Pure logic (CPF, Price, breaker math, adapter mapping) is unit-tested without a DB.

**Why.**

1. The orchestration tests exist to prove race safety (finalizer vs late worker, double choose); that needs real concurrent connections, which PGlite can't produce.
2. User rule: integration tests exercise the real codebase and infra. A factory that writes rows directly can produce states the real code never would, and drifts from it silently.
3. Same engine, driver and migrations as production.

**Evidence.** A — PDF p.2 (mandatory orchestration tests); user directive. B — PGlite single-connection semantics.
**Dissent.** PGlite needs no container and runs in milliseconds; setting up through real services makes some edge states (e.g. an attempt stuck `PENDING` past the deadline) slower to reach.
**Riskiest assumption.** Every state a test needs is reachable through the real code paths (e.g. "worker died mid-call" via a simulator that never answers + finalizer, not by writing a `PENDING` row by hand).
**Test.** For each orchestration test, list the setup calls; none may import the DB client or a table object directly.
**Would reopen if.** A required edge state is genuinely unreachable through real code, or suite time exceeds a few minutes.

### Q21 — When nobody approves, what reason is shown and how does "try a smaller amount" work?

**Decision.** Lender adapters map refusals to canonical, non-sensitive categories: `AMOUNT_ABOVE_LIMIT`, `PROFILE_NOT_ELIGIBLE`, plus the non-answer reasons from Q10/Q11. They also pass an optional `maxApprovableCents` hint _only if the lender's contract returns one_; the simulated contracts do. The screen explains per category and suggests the highest hinted amount. `POST /api/consultations/:id/requote { treatmentAmountCents }` creates a **new standalone consultation** server-side from the source consultation's patient data. No PII goes back to the browser, it works after a reload, and no link column is stored (Q15).

**Why.**

1. Satisfies the PDF ("explica o motivo e oferece um próximo passo, como tentar um valor menor") without showing sensitive reasons (HTML `:254`).
2. Lender policy stays inside the lender; the core never encodes "income × 10" or "R$ 20k".
3. A server-side copy is the only retry that holds up with Q13 (no PII in public responses) and Q14 (no client draft after reload).

**Evidence.** A — PDF p.2; HTML `jornada-credito-parcela-mais.html:254`; Q13, Q14, Q15 records.
**Dissent.** A generic "try a smaller amount" with no specific number avoids depending on lender hints and needs no extra endpoint.
**Riskiest assumption.** Real lenders return a usable limit hint often enough for the suggestion to be specific.
**Test.** `NONE_APPROVE` with Alfa refusing on income: the screen shows `AMOUNT_ABOVE_LIMIT` and suggests Alfa's hinted amount; the requote creates a second consultation whose frozen inputs equal the first except the amount.
**Would reopen if.** Lenders return no hints, or requote is abused (see Q22).

**Amendment (post-review, agent).** Requote guards: (1) it's idempotent with its own client `Idempotency-Key` (unique, request hash), the same mechanism as D12, so a double click never fans out twice; (2) the D10 preconditions apply (source terminal with zero approvals, strictly lower amount); (3) the Q22 per-patient cap applies; (4) `simulation_scenario` **resets to `NORMAL`** unless the requote body explicitly sends one, and that's accepted only when `SIMULATION_CONTROLS=true`. A forced "none approve" therefore doesn't silently stick to the retry.

### Q22 — What limits consultation creation (form + requote) on a public, login-less API where each consultation is 4 credit inquiries?

**Decision.** Two layers. (1) **Domain rule:** at most N consultations per patient per rolling window (initial 5 / 24 h), counted on `consultation(patient_id, created_at)` inside the creation transaction in the consultation domain service; exceeding it returns 429 with a clear message. It covers both the form and requote. (2) **Edge cap:** a native Elysia `onBeforeHandle` guard on `POST /api/consultations` and `POST /api/consultations/:id/requote` that counts recent consultations per client IP in Postgres. The client IP is read only from the header the reverse proxy overwrites (`X-Forwarded-For`/`X-Real-IP`; client-supplied values are discarded by the proxy). No rate-limit library. Requote preconditions (agent decision, see §3): the source consultation must be terminal with zero approvals, and the new amount must be lower.

**Why.**

1. The harm is per patient (inquiries against one CPF), so the binding limit is per patient and lives in the domain, counted from the DB (single source of truth, survives restarts).
2. The per-IP cap catches spraying across many CPFs.
3. `elysia-nazli` was rejected on evidence: its README says "Node.js is not supported" (dev/test run on Node, Q3), and its default key is `ctx.server?.requestIP` (`src/index.ts:86`), which is absent when Elysia is mounted through TanStack Start's `app.fetch` and would be the proxy anyway.

**Evidence.** A — elysia-nazli README + `src/index.ts:86`; Q10 (inquiry harm). B — `ctx.server` absent under `app.fetch` mounting (inferred from the integration shape, not executed).
**Dissent.** A maintained library gives bans, algorithms and standard `RateLimit-*` headers for free; the DB count costs a query per POST.
**Riskiest assumption.** The proxy always overwrites the client-IP header, so it can't be spoofed.
**Test.** Send `POST /api/consultations` with a forged `X-Forwarded-For` through the proxy; the stored/counted IP must be the real peer. Six submissions for one CPF in 24 h → the sixth gets 429.
**Would reopen if.** Legitimate clinics hit the per-CPF cap, or the app is ever exposed without the proxy in front.

**Amendment (post-review, agent).** The per-IP guard counts rows in a dedicated `request_throttle` table (`ip_hmac`, `route`, `created_at`), never an IP column on `consultation`. Every POST to the two guarded routes is recorded **before** validation, so invalid or rejected requests count too. Rows older than the window are purged by a pg-boss scheduled job (the worker is long-lived, Q2b). Caddy _overwrites_ `X-Forwarded-For` with the peer address (it doesn't append), and the guard trusts only that header.
**Supersedes.** User's initial suggestion of `elysia-nazli` (withdrawn by the user after the evidence).

### Q23 — Which schema library carries "DB is the source of truth" through API, form and env?

**Decision.** TypeBox everywhere. Upgrade to `drizzle-orm@rc` (v1) and generate schemas with `drizzle-orm/typebox` (TypeBox 1.x, package `typebox`). Those generated schemas, refined/picked per contract, are the Elysia route schemas (validation, OpenAPI, Eden types). TanStack Form validators and `@t3-oss/env-core` consume the same TypeBox schemas through **one** shared TypeBox → Standard Schema adapter module (TypeBox deliberately doesn't implement Standard Schema). zod is removed from the project. Relations use drizzle v1 `defineRelations`/`defineRelationsPart`.

**Why.**

1. "Native on Elysia first": Elysia's official v2 guidance is `drizzle-orm@rc` + `drizzle-orm/typebox` and explicitly warns against the legacy `drizzle-typebox` (elysiajs/skills `elysia/references/drizzle.md`).
2. One schema library from table to form to env: no translation between validation dialects.
3. drizzle v1 removes v0 `relations()`/RQBv1, so building on 0.45 would mean a forced migration later.

**Evidence.** A — elysiajs/skills drizzle reference; drizzle v0→v1 docs; template `package.json:32,38` (drizzle 0.45.1, zod 4). B — TypeBox has no native Standard Schema (typebox discussion #1152), so an adapter is needed.
**Dissent.** zod via `drizzle-orm/zod` is natively Standard Schema for TanStack Form and t3-env and supported by Elysia with OpenAPI mapping, so no adapter layer to write and test.
**Riskiest assumption.** A TypeBox → Standard Schema adapter gives TanStack Form field-level error paths and messages as good as a native Standard Schema library.
**Test.** Wire the CPF and birthdate fields through the adapter; an invalid CPF must surface on the CPF field (not the form root) with the custom message.
**Would reopen if.** The adapter can't map per-field error paths, or drizzle v1 RC blocks a needed feature.

**Amendment (post-review, agent).** Adapter path: one in-house `toStandardSchema(schema)` in a shared module (no third-party adapter, no zod). It compiles the TypeBox schema, validates with `typebox/value`, and maps each `Value.Errors` item to a Standard Schema issue: `path` = `instancePath` split on `/` (verified: `/patient/cpf` → `['patient','cpf']`, TypeBox 1.4.3 under Node), `message` = a pt-BR message resolved from the schema's custom error option or a per-`keyword` pt-BR table (TypeBox's defaults are English). TanStack Form and `@t3-oss/env-core` both consume it. **Pinned versions** (RC, exact, no ranges): `drizzle-orm@1.0.0-rc.5`, `drizzle-kit@1.0.0-rc.5` (paired), `typebox@1.4.3`, `elysia@2.0.0-rc.0`, `@elysia/eden@2.0.0-rc.0`.
**Supersedes.** Template `src/env.ts:2` (zod) and `src/db/index.ts` on drizzle 0.45.1.

### Q24 — Can the patient choose an offer while other lenders are still "consultando"?

**Decision.** Yes. "Escolher" is enabled on each offer as soon as it arrives. Choosing sets `consultation.chosen_offer_id` (guarded, set-once) and moves the consultation to `CHOSEN`; the screen switches to confirmation. Pending attempts keep running to settlement or deadline and are still recorded (dashboard/metrics), but they can't change the choice.

**Why.**

1. The case's premise is a fast, useful answer with the patient in front of the clinic (PDF p.1); waiting on a 4–15 s lender contradicts it.
2. Matches the HTML's "não faria o paciente esperar a financeira mais lenta" (`jornada-credito-parcela-mais.html:246`).
3. Recording late answers keeps lender metrics and the consultation history complete.

**Evidence.** A — PDF p.1–2; HTML `:246`.
**Dissent.** A cheaper offer can arrive after the choice and the patient never sees it; waiting for all lenders or the deadline guarantees a full comparison.
**Riskiest assumption.** Patients and clinics accept missing a possibly better late offer in exchange for speed.
**Test.** `DELTA_TIMES_OUT` with an Alfa offer at ~1 s: choose immediately → confirmation; after the deadline, Delta's attempt is `UNAVAILABLE(TIMEOUT)` in the backoffice and `chosen_offer_id` is unchanged.
**Would reopen if.** The dashboard shows chosen offers regularly beaten by late offers from the same consultation.

### Q25 — What must the backoffice show?

**Decision.** All four areas, derived from existing tables (`consultation`, `lender_attempt`, `offer`, kill-switch log, pg-boss queue stats) with no new reporting tables: (1) **Money pipeline**: requested vs approved vs chosen volume over time, approval rate, approved/requested ratio, chosen volume per lender, average installment and total cost of chosen offers. (2) **Lender health**: p50/p95 latency, approval/refusal/error/timeout rates, derived breaker state (Q11), kill-switch state + change log with actor (Q12), queue backlog. (3) **Consultation explorer**: list + detail with full patient data (decrypted CPF, Q16), frozen inputs, attempt timeline and reasons, offers, choice. (4) **Abuse & limits**: consultations hitting Q22 limits, 429 counts, top CPFs/IPs by volume in 24 h.

**Why.**

1. User confirmed all four (closes Q1's riskiest assumption).
2. Every metric derives from the business tables, keeping one source of truth.

**Evidence.** A — user decision.
**Dissent.** Four areas is the largest UI surface in the project, and it's a bonus item in the PDF.
**Riskiest assumption.** Aggregates over the raw tables stay fast enough without materialized views at simulation volumes.
**Test.** Seed 10k consultations through the real API (Q20) and check each dashboard query under 200 ms.
**Would reopen if.** Any dashboard query exceeds 500 ms at realistic volume.
**Supersedes.** Q1's riskiest assumption (now confirmed).

**Amendment (post-review, agent).** "Every applicable field" is made concrete per table: each list endpoint declares an explicit **allow-list** of filterable, sortable and searchable fields mapped to real Drizzle columns (the shared TypeBox list contract rejects anything else with 422), plus a stable `id` tiebreaker on every sort and an index per allowed sort/filter column. CPF is never list-filterable, sortable or searchable, and list rows never decrypt. CPF lookup is exact-match only, via `cpf_hmac` in a POST body (D19); decryption happens only in the detail view. The no-SSR directive is implemented with TanStack Start's selective SSR turned off for every route (`ssr: false` as the app default). File routing, typed search params (table state in the URL, except CPF), client loaders, preloading and server routes hosting Elysia stay. Stage 3 confirms the exact switch against the current TanStack Start docs.

> **User directive (mid-session):** every data table in the app is **server-first**: filtering, ordering, searching and pagination run in the API, for every applicable field, with one default request/response format shared by every list endpoint and every table component in the front.
>
> **User directive (mid-session, important):** **no SSR in the front.** The frontend gets all data by requesting the API over HTTP (Eden client). It still uses TanStack Start's advantages (file routing, type-safe search params, server routes hosting Elysia, code splitting, preloading, client-side loaders). Consequence: the server branch of the integration's `createIsomorphicFn` Eden pattern (in-process `treaty(app)` during SSR) is not used; route components and loaders run in the browser.

### Q26 — One pagination model for every list endpoint and table: offset or keyset?

**Decision.** Offset/limit everywhere, in one shared format. Request: `?page=&pageSize=&sort=field:dir&q=&<field filters>`. Response: `{ items, page, pageSize, total, totalPages }`. The same TypeBox contract and the same front table component serve every list (Q25 directive).

**Why.**

1. User choice: page numbers and totals are the familiar admin UX.
2. One format with no cursor encoding makes "sort by any field" trivial.

**Evidence.** A — user decision.
**Dissent.** The HTML explicitly says "keyset, nunca OFFSET" (`jornada-credito-parcela-mais.html:458`) after a 9.32 GiB OOM; OFFSET scans grow with page depth and `COUNT(*)` runs on every request. This default gets copied into every future table.
**Riskiest assumption.** List volumes stay small enough that deep OFFSET and per-request `COUNT(*)` remain cheap.
**Test.** With 100k consultations seeded through the API, request page 1 and page 900 sorted by `created_at`; both must stay under 200 ms.
**Would reopen if.** Any list endpoint's deep-page or count latency exceeds 500 ms.

## 2. Corrections — claims in the source material proven false or superseded

| #   | Claim                                                                                                                           | Evidence                                                                                                                                                                         | Grade | Effect                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------ |
| C1  | "This project should be easy to deploy in Vercel" (brief)                                                                       | Vercel has no persistent processes; pg-boss needs a running worker (pgboss.io/api/workers, /api/scheduling)                                                                      | A     | Pivot to VPS (Q2, Q2b); `vercel.json` obsolete                                 |
| C2  | "Everything in Bun" is compatible with "Vite+ full toolchain"                                                                   | `vp env` manages one Node.js runtime; Bun is a package-manager family only (`node_modules/vite-plus/docs/guide/env.md:3`)                                                        | A     | Bun = container runtime; `vp dev`/`vp test` on Node; no `Bun.*` in `src/` (Q3) |
| C3  | HTML reference architecture (SKIP LOCKED workers, LISTEN/NOTIFY) is deployable as briefed                                       | Requires persistent workers (`jornada-credito-parcela-mais.html:595-600,680-699`); impossible on Vercel                                                                          | A     | Made true by the VPS pivot; realized with pg-boss (Q8)                         |
| C4  | `elysia-nazli` fits the stack                                                                                                   | README: "Node.js is not supported"; default key `ctx.server?.requestIP` (`src/index.ts:86`) absent under `app.fetch` mounting and equal to the proxy anyway                      | A / B | Rejected; native guard (Q22)                                                   |
| C5  | Template's zod + drizzle 0.45 is the right base for "Elysia native first"                                                       | Elysia v2 guidance: `drizzle-orm@rc` + `drizzle-orm/typebox` (elysiajs/skills `elysia/references/drizzle.md`); drizzle v1 removes v0 `relations()`                               | A     | Upgrade + TypeBox everywhere (Q23)                                             |
| C6  | Elysia's TanStack Start Eden example (`createIsomorphicFn` server branch, `treaty<typeof app>('localhost:3000')`) applies as-is | User directive "no SSR in the front"; a hard-coded `localhost:3000` origin breaks behind the proxy                                                                               | B     | Client-only Eden with same-origin base URL                                     |
| C7  | PDF "explica o motivo" vs HTML "sem motivo sensível na tela" (`:254`)                                                           | Both A, contradictory                                                                                                                                                            | A     | Reconciled: canonical non-sensitive reason categories (Q21)                    |
| C8  | HTML lenders (Parcelex, Brasil Card, SRM; "até 3") are the build's lenders                                                      | PDF defines 4 fictional lenders Alfa/Beta/Gama/Delta with explicit rules (p.2–3)                                                                                                 | A     | PDF lenders are built; HTML names are reference only                           |
| C9  | The public CPF mask `***.456.789-**` is harmless                                                                                | It reveals 6 of 9 base digits, so anyone holding the HMAC key brute-forces the rest in 1,000 tries (computed in the explainer demo), and it forces decryption on the public path | A     | Public responses carry no CPF at all (Q13 amendment)                           |

## 3. Decisions I took myself (vetoable — say so if you disagree)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                         | Evidence                                                                                                                               | Grade |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| D1  | Scale `standard`; prototype gate not triggered                                                                                                                                                                                                                                                                                                                                   | Header rationale                                                                                                                       | B     |
| D2  | Ops scripts live in `scripts/ops/{doctor,up,prune,deploy}.ts`, run on Bun (Bun Shell allowed outside `src/`), exposed as uncached `package.json` scripts → `vp run <name>`                                                                                                                                                                                                       | No collision with `vp` built-ins (`vp help`); `package.json` scripts are not cached, `vite.config.ts` tasks are (`run.md:114-117`)     | A     |
| D3  | `doctor` checks: container engine (podman/docker) + compose provider, Bun version vs `devEngines` 1.4.4, env against the TypeBox env schema, DB reachability, pending drizzle + pg-boss migrations, free ports, rootless-Podman unprivileged-port floor for 80/443. Read-only, local only                                                                                        | Q3, Q2b, Q6 directive                                                                                                                  | B     |
| D4  | Reverse proxy = Caddy with a static Caddyfile (no container-socket mount, Podman-friendly); fully qualified image names (`docker.io/…`); overwrites `X-Forwarded-For`/`X-Real-IP`; no buffering for `text/event-stream`; TLS hostname from env                                                                                                                                   | Podman short-name resolution, Q9, Q22                                                                                                  | B     |
| D5  | One-shot `migrate` service applies drizzle migrations and installs/migrates the pg-boss schema; app and worker start pg-boss with `migrate: false`                                                                                                                                                                                                                               | pgboss.io constructor `migrate` option; Q4 gating                                                                                      | A     |
| D6  | Worker = separate Bun process, same image, different entrypoint, running TS directly                                                                                                                                                                                                                                                                                             | Q2b, Q8                                                                                                                                | B     |
| D7  | Backoffice password hashed with scrypt via `node:crypto`                                                                                                                                                                                                                                                                                                                         | Q3 (no `Bun.password` in `src/`)                                                                                                       | A     |
| D8  | CPF crypto details: HMAC input `"cpf:v1:" + digits`; AES-GCM AAD = `cpf_hmac`; envelope `iv(12) ‖ ct(11) ‖ tag(16)` in one `bytea` + `cpf_key_version smallint`; no mask anywhere public; decryption only in the authenticated backoffice detail; upsert `ON CONFLICT (cpf_hmac)` updates contact fields only, never the ciphertext. Verified in `cpf-protection-explainer.html` | Explainer demo run (WebCrypto)                                                                                                         | A     |
| D9  | Client IP for the per-IP cap is stored only as `HMAC("ip:v1:" + ip)` in `request_throttle` (Q22 amendment), purged after the window                                                                                                                                                                                                                                              | IP is personal data; Q16 philosophy                                                                                                    | B     |
| D10 | Requote preconditions: source consultation terminal, zero approvals, new amount strictly lower; idempotent; scenario resets to `NORMAL` (Q21 amendment)                                                                                                                                                                                                                          | Q21, Q22                                                                                                                               | B     |
| D11 | Money: amounts in integer cents (`bigint`); monthly rate as `numeric(7,6)`; Price PMT computed with exact decimal arithmetic in the pricing service, rounded half-up to the cent; `total_cents = installment_cents × n`; the front only formats (`Intl.NumberFormat('pt-BR', BRL)`)                                                                                              | PDF formula p.2; HTML `:264-271`                                                                                                       | B     |
| D12 | `POST /api/consultations` idempotent: the client generates an `Idempotency-Key` when the form mounts; `consultation.idempotency_key` unique + request hash; replay → original response, same key with a different body → 422                                                                                                                                                     | HTML `:281-286`, `:483`                                                                                                                | B     |
| D13 | Drizzle: one table per file; that table's relations in a sibling `<table>.relations.ts` via `defineRelationsPart`, declaring the relations that originate at that table; parts combined in one relations index                                                                                                                                                                   | A part needs the full schema object, and defining it inside the table file creates circular imports between table files and the barrel | B     |
| D14 | Choose endpoint: guarded set-once; re-choosing the same offer → 200 with the same body; a different offer after a choice → 409                                                                                                                                                                                                                                                   | Q17, Q24                                                                                                                               | B     |
| D15 | UI in pt-BR; keyboard + screen-reader accessibility on Base UI primitives; lender status changes announced via `aria-live`                                                                                                                                                                                                                                                       | PDF bonus; HTML `:235`                                                                                                                 | B     |
| D16 | Structured JSON logs per lender call (lender, attempt id, latency, outcome, reason) with PII redaction; metrics derived from `lender_attempt` (Q25)                                                                                                                                                                                                                              | PDF bonus "logs ou métricas por financeira"                                                                                            | B     |
| D17 | No offer expiry                                                                                                                                                                                                                                                                                                                                                                  | Q1 scope; Q17 reopen trigger                                                                                                           | B     |
| D18 | One global `deadline_at = created_at + 10 s`; each lender call's timeout = remaining budget                                                                                                                                                                                                                                                                                      | PDF p.1                                                                                                                                | A     |
| D19 | Backoffice CPF search goes in a POST body, never a query string, an explicit exception to URL-held table state                                                                                                                                                                                                                                                                   | HTML `:234` (no PII in URL); proxy access logs                                                                                         | A     |
| D20 | nitro targets the Bun preset; `vercel.json` and the Vercel add-on are removed                                                                                                                                                                                                                                                                                                    | Q2b                                                                                                                                    | A     |

## 4. Still open, and why

### O1 — Public hostname / TLS domain — STILL OPEN

**Blocked on.** The user's DNS/domain for the VPS.
**Cost of leaving it open.** Caddy can't issue a certificate; `deploy` health check runs on localhost only.
**Provisional.** `APP_DOMAIN` env; unset → Caddy serves HTTP on the IP (dev/staging only).

### O2 — Rate-limit thresholds — STILL OPEN

**Blocked on.** Real clinic usage patterns.
**Cost of leaving it open.** Wrong values either block legitimate retries or let abuse through.
**Provisional.** 5 consultations / patient / 24 h; 30 consultations / client IP / hour. Both env-configurable.

### O3 — VPS OS and Podman mode — STILL OPEN

**Blocked on.** Provider/OS of the trial box (unknown from the spec screenshot).
**Cost of leaving it open.** Rootless Podman can't bind 80/443 without sysctl `net.ipv4.ip_unprivileged_port_start`; `doctor` must report it.
**Provisional.** Assume rootless Podman on a systemd Linux distro; `doctor` checks the port floor.

> **Research for Stage 3 (not open decisions):** the TanStack Start mechanism that disables SSR app-wide (SPA mode vs `ssr: false` default) per its current docs; whether `app.handle`/`treaty(app)` run under `vp test` (Q19); the TypeBox → Standard Schema adapter's error-path mapping (Q23); whether `defineRelationsPart` merges parts built from table subsets (D13).

## 5. Decision matrix (for Stage 2)

| Q       | Topic                                                  | RFC anchor                                                 | PRD anchor                             |
| ------- | ------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------- |
| Q1      | Scope stages 1–3                                       | §Scope / Non-goals                                         | Goals, Out of scope                    |
| Q2/Q2b  | VPS, compose, Podman+Docker                            | §Deployment topology                                       | NFR: one-command run                   |
| Q3      | Bun runtime, portable `src/`                           | §Runtime & toolchain                                       | —                                      |
| Q4–Q7   | `deploy`, `prune`, git boundary, `up`                  | §Operations CLI                                            | NFR: operability                       |
| Q8      | pg-boss per-lender jobs, transactional send, finalizer | §Orchestration                                             | R: 10 s deadline, partial results      |
| Q9      | SSE snapshot + NOTIFY hint                             | §Realtime transport                                        | R: per-lender live status              |
| Q10–Q11 | No retry; breaker + kill switch                        | §Fault tolerance                                           | R: lender unavailable handling         |
| Q12     | Backoffice auth                                        | §Security: backoffice                                      | R: protected backoffice                |
| Q13–Q16 | Capability URL, no draft, patient/snapshot, CPF crypto | §Data model, §Privacy (LGPD)                               | R: resume after reload; NFR: PII       |
| Q17     | Offer rows, pricing service                            | §Pricing domain                                            | R: Price installments, sorting, choice |
| Q18–Q19 | Forced scenarios; simulator + HTTP adapters            | §Lender port & simulator                                   | R: forced scenarios                    |
| Q20     | Real-Postgres integration tests, no factories          | §Testing strategy                                          | NFR: tests on critical parts           |
| Q21–Q22 | No-approval path, requote, limits                      | §Abuse controls, §No-offer flow                            | R: next step on refusal                |
| Q23     | drizzle v1 + TypeBox everywhere                        | §Schema & validation                                       | —                                      |
| Q24     | Choose before deadline                                 | §Consultation state machine                                | R: choose any arrived offer            |
| Q25–Q26 | Dashboard, server-first tables, offset paging, no SSR  | §Backoffice, §API list conventions, §Frontend architecture | R: dashboard areas, table behaviors    |

## 6. Investigation trail

1. Read PDF case (all 5 pages) and the HTML journey (`:157-530` content, `:534-763` diagram specs).
2. Read the template: `package.json`, `vite.config.ts`, `tsconfig.json`, `.cta.json`, `vercel.json`, `src/db/{index,schema}.ts`, `src/env.ts`, `.env.local`.
3. Verified vp runtime model (`node_modules/vite-plus/docs/guide/env.md:3`), vp built-ins (`vp help`), task caching (`docs/guide/run.md:45-117`).
4. Read the Elysia ↔ TanStack Start integration (next.elysiajs.com/integrations/tanstack-start), Elysia unit-test pattern, Elysia's official drizzle reference (elysiajs/skills).
5. Verified Vercel Bun runtime (beta, `1.4.x` Rust rewrite), duration limits, `waitUntil` (vercel.com docs) before the pivot.
6. Verified pg-boss: polling workers, scheduling needs a live instance, `pg` dependency, `db.executeSql` adapter, transactional `send({ db })`, `useListenNotify` (pgboss.io, pg-boss `package.json`).
7. Inspected `elysia-nazli` README and `src/index.ts` (Node unsupported; `ctx.server.requestIP`).
8. Verified drizzle v1 relations API (`defineRelations`/`defineRelationsPart`) and TypeBox's stance on Standard Schema.
9. Computed breaker false-trip odds (binomial): P(≥5/10 | p=0.3) = 0.150; P(≥16/20) = 5.6×10⁻⁶.
10. Built and browser-verified `cpf-protection-explainer.html` (HMAC stable, ciphertext randomized, AAD swap rejected, SHA-256 + mask brute force in 9 ms, HMAC attack without key fails).

## Companion artifacts

- `docs/features/pre-approval-journey/cpf-protection-explainer.html` — visual, interactive explanation of Q16 + D8.
- `knowledge/stack-baseline.md` — verified ground truth about the template and toolchain.
