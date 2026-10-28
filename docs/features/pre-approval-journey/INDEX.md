# Pre-approval journey — Knowledge Index

A clinic enters a patient's data once, four simulated lenders are queried in parallel under a 10-second deadline, offers arrive live with Tabela Price installments, and the patient's choice is persisted. A protected backoffice tracks money volume, lender health, consultations and abuse. It deliberately stops at the choice: no proposal submission, analysis, signing, disbursement or ledger.

| Field            | Value                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Status**       | `parcela-mais-case`: Stage 4: implementation in progress (checklist in `.ef/pre-approval-journey/`; waves 0–1 landed) (2026-10-28) |
| **Driver**       | Micael                                                                                                                             |
| **Target repos** | `parcela-mais-case`                                                                                                                |
| **Ticket**       | none                                                                                                                               |
| **Scale**        | `standard`                                                                                                                         |

---

## Root documents

| Doc                                                                     | Purpose                                                                                                                  | When to update                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [knowledge/stack-baseline.md](../../../knowledge/stack-baseline.md)     | Verified ground truth about the template and toolchain, with citations. **Common knowledge base.**                       | When the underlying system or dependency versions change          |
| [grill-decisions](./grill-decisions-2026-10-27-pre-approval-journey.md) | The decisions and rationale. **Source of truth for rationale.**                                                          | When a decision is revisited                                      |
| [RFC](./RFC-pre-approval-journey.md)                                    | Decisions D1–D26 with options considered and rejected, criteria, assumptions, risks; **the only cross-repo status home** | When a decision or assumption changes (Stages 3–5 amend in place) |
| [PRD](./PRD-pre-approval-journey.md)                                    | Requirements RF-101…RF-811 with acceptance criteria, metrics, non-goals: **the identifier registry**                     | When scope or a requirement changes                               |
| [cpf-protection-explainer.html](./cpf-protection-explainer.html)        | Interactive explanation of CPF encryption + HMAC blind index (D16, AD8)                                                  | When D16 or AD8 changes                                           |
| handoff doc                                                             | What actually shipped, written from the code                                                                             | Stage 5 (not yet written)                                         |

---

## Reading order

1. **knowledge/stack-baseline.md**: what the template is today and which toolchain facts constrain the design
2. **grill-decisions**: the objective, the corrections to the brief, and the decision matrix
3. **RFC**: resolved decisions with rejected options, assumptions and risks
4. **PRD**: requirements and acceptance criteria
5. **cpf-protection-explainer.html**: before touching anything that stores or shows a CPF
6. **handoff doc**: once Stage 5 writes it

---

## Decision index

| #        | Decision                                                | Anchor                                                                                                                  |
| -------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Q1       | Scope: stages 1–3 + pipeline/risk backoffice; no ledger | [RFC D1](./RFC-pre-approval-journey.md#d1-scope-is-journey-stages-13-plus-a-pipelinerisk-backoffice-no-ledger-grill-q1) |
| Q2       | PIVOT: Vercel fan-out question reframed                 | RFC D2                                                                                                                  |
| Q2b      | Single VPS, Podman/Docker compose stack                 | RFC D2b                                                                                                                 |
| Q3       | Bun container runtime; Vite+ on Node; portable `src/`   | RFC D3                                                                                                                  |
| Q4       | `deploy` builds on the box                              | RFC D4                                                                                                                  |
| Q5       | `prune` is a local reset only                           | RFC D5                                                                                                                  |
| Q6       | `deploy` builds the current checkout; no remote calls   | RFC D6                                                                                                                  |
| Q7       | `up` = dev, `up --prod` = parity                        | RFC D7                                                                                                                  |
| Q8       | Per-lender pg-boss jobs in the creation TX              | RFC D8                                                                                                                  |
| Q9       | SSE snapshot + NOTIFY hint                              | RFC D9                                                                                                                  |
| Q10      | No lender retries                                       | RFC D10                                                                                                                 |
| Q11      | Circuit breaker + kill switch                           | RFC D11                                                                                                                 |
| Q12      | Single-operator backoffice auth                         | RFC D12                                                                                                                 |
| Q13      | Capability URL; no PII/CPF publicly                     | RFC D13                                                                                                                 |
| Q14      | No pre-submit draft                                     | RFC D14                                                                                                                 |
| Q15      | Patient by CPF; frozen consultation inputs              | RFC D15                                                                                                                 |
| Q16      | CPF encrypted + HMAC index                              | RFC D16                                                                                                                 |
| Q17      | Immutable offers from the pricing service               | RFC D17                                                                                                                 |
| Q18      | Forced scenarios per consultation, env-gated            | RFC D18                                                                                                                 |
| Q19      | Simulator + real HTTP adapters                          | RFC D19                                                                                                                 |
| Q20      | Real-Postgres integration tests, no factories           | RFC D20                                                                                                                 |
| Q21      | No-approval reasons + requote                           | RFC D21                                                                                                                 |
| Q22      | Per-patient + per-IP limits                             | RFC D22                                                                                                                 |
| Q23      | drizzle v1 RC + TypeBox everywhere                      | RFC D23                                                                                                                 |
| Q24      | Choose as soon as an offer arrives                      | RFC D24                                                                                                                 |
| Q25      | Four backoffice areas; server-first lists; no SSR       | RFC D25                                                                                                                 |
| Q26      | Offset pagination, one shared format                    | RFC D26                                                                                                                 |
| grill §3 | Agent decisions (vetoable)                              | RFC AD1–AD20                                                                                                            |

---

## Per-repo status

| Repo                | Stage                                                 | Last updated | Notes                                 |
| ------------------- | ----------------------------------------------------- | ------------ | ------------------------------------- |
| `parcela-mais-case` | 4: implementation in progress (waves 0–1 of 6 landed) | 2026-10-28   | Next: `/ef:audit` after the last wave |

The RFC header is normative; this table is a convenience copy.

---

## Related

- **Ground-truth code:** `package.json`, `vite.config.ts`, `src/db/index.ts`, `src/db/schema.ts`, `src/env.ts`, `vercel.json`, `.cta.json` (see knowledge/stack-baseline.md)
- **Reused patterns:** Elysia ↔ TanStack Start mounting via `src/routes/api.$.ts` (next.elysiajs.com/integrations/tanstack-start); Elysia v2 + `drizzle-orm/typebox` (elysiajs/skills); pg-boss transactional send (pgboss.io/api/adapters)
- **Reference architecture:** `C:\Users\Micael\Projects\learning-tech\jornada-credito-parcela-mais.html`
- **Source specification:** `C:\Users\Micael\Downloads\Case Técnico · Dev Full Stack Sênior.pdf`
- **Sibling precedent:** none, this is the first feature folder in the repo
