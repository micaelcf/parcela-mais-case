# S1 — the schema, migrations, queue and integration harness exist and run against real Postgres · ~30 files · est. ~10k

Builder: lead, inline (shared prerequisite).

Owns: `drizzle.config.ts`, `drizzle/**`, `src/db/**` (delete), `src/server/infra/db/**`, `src/server/infra/queue/**`, `src/server/modules/*/db/**` (every `*.table.ts` and `*.relations.ts` in `schema.md`), `test/integration/setup/global-setup.ts`, `test/integration/setup/file-db.setup.ts`, `scripts/ops/migrate.ts`
Reads: contract/bindings.md, contract/layout.md, contract/schema.md, contract/boundaries.md

Non-goals: no repository or service; no queue handler.

**C9** · RF-806 — the lint override for `**/*.int.test.ts` rejects an import of `#/server/infra/db/client` and of any `*.table` module (negative probe: a scratch file importing each fails `vp lint`; recorded in `log.md`)
Proof: `vp check`
Proof: `log.md` § S1 "RF-806 lint probe"

**C10** · (no RF; schema provenance) after the last slice lands, `vp run db:generate` produces no new migration: `git status --porcelain drizzle/` prints nothing
Proof: `vp run db:generate && git status --porcelain drizzle/`

**C11** · (no RF; data lifecycle) the migration seeds `lender_setting` with the four lenders enabled, and re-running `migrate` is a no-op (second run exits 0, row count unchanged)
Proof: `vp test test/integration/infra/migrate.int.test.ts -t "is idempotent and seeds the four lenders enabled"`

C6–C7 from S0 are proven here once `list-query.ts` lands.
