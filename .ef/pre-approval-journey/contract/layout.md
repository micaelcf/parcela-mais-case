# Layout and naming

The path says what a file does. DDD by feature: every backend module separates **routes** (HTTP entry), **service** (the only home of business rules), **repository** (the only code that talks to the DB) and **schemas** (TypeBox contracts). Workers and routes are thin entry points: they translate, call a service and translate back.

## Tree

```text
src/
  server/                                   # backend only — never imported by browser code except `import type`
    app.ts                                  # root Elysia({ prefix: "/api" }); .use(errors, health, config, modules…); export type App
    worker/main.ts                          # worker process entry: boot boss, register jobs, graceful stop
    shared/
      env/server-env.ts                     # validated server env (process.env)
      db/client.ts                          # pg.Pool + drizzle({ client, relations }) singleton
      db/schema.ts                          # barrel: re-exports every *.table.ts (tables only)
      db/relations.ts                       # { ...defineRelationsPart(schema), ...each *.relations.ts }
      db/uuid.ts                            # uuidv7() via node:crypto (portable; no pg18 dependency)
      db/list-query.ts                      # shared offset/limit list engine (allow-lists → SQL)
      queue/boss.ts                         # PgBoss singleton (own pool, max 3) + start/stop
      queue/queues.ts                       # queue names + createQueue options (single source)
      realtime/consultation-events.ts       # one LISTEN client on `consultation_updated` + in-memory fan-out
      http/errors.plugin.ts                 # onError(ValidationError) + domain error → problem+json
      http/client-ip.ts                     # read X-Forwarded-For set by Caddy
      pii/cpf-crypto.service.ts             # blindIndex / encrypt / decrypt (the only node:crypto importer for PII)
      pii/ip-hash.ts                        # HMAC("ip:v1:" + ip)
    modules/
      consultation/
        db/consultation.table.ts            db/consultation.relations.ts
        consultation.schemas.ts             # request/response TypeBox (isomorphic: tables + typebox only)
        consultation.repository.ts
        consultation.service.ts             # create, requote, choose, read view, finalize, limits
        consultation.routes.ts              # public routes + SSE
        consultation-view.ts                # pure: rows → ConsultationPublicView (journeyStatus derivation)
      patient/
        db/patient.table.ts                 db/patient.relations.ts
        patient.repository.ts               patient.service.ts      # upsert by cpf_hmac
      lender/
        db/lender-attempt.table.ts          db/lender-attempt.relations.ts
        db/lender-setting.table.ts          db/lender-switch-log.table.ts
        lender.port.ts                      # LenderPort + canonical result types
        adapters/alfa.adapter.ts  adapters/beta.adapter.ts  adapters/gama.adapter.ts  adapters/delta.adapter.ts
        adapters/registry.ts                # LenderCode → adapter
        circuit-breaker.ts                  # pure derivation over attempt rows
        lender-attempt.repository.ts
        lender-attempt.service.ts           # pick → breaker/switch → call → settle (via pricing)
        lender-attempt.job.ts               # pg-boss handlers (thin)
      pricing/
        db/offer.table.ts                   db/offer.relations.ts
        price.ts                            # pure Tabela Price, exact rational BigInt
        pricing.service.ts                  # attempt result → offer rows (the only Price caller)
        offer.repository.ts
      throttle/
        db/request-throttle.table.ts
        throttle.plugin.ts                  # per-IP guard on the two POST routes
        throttle.repository.ts              throttle.service.ts
        throttle-purge.job.ts
      simulator/
        simulator.plugin.ts                 # Elysia plugin at /simulator/lenders
        lenders/alfa.simulator.ts … delta.simulator.ts
        scenario.ts                         # scenario → per-lender behaviour (pure)
      backoffice/
        auth/backoffice-auth.plugin.ts      auth/password.ts       # scrypt verify
        backoffice.routes.ts                metrics.repository.ts  metrics.service.ts
  shared/                                   # isomorphic: safe in browser AND server
    schema/standard-schema.ts               # toStandardSchema(TypeBox) adapter
    schema/locale.ts                        # System.Locale pt_BR + keyword messages
    schema/list-contract.ts                 # ListQuery/ListResponse TypeBox
    domain/cpf.ts                           # normalize + check digits + Cpf TypeBox refine
    domain/money.ts                         # formatBRL (Intl), cents helpers (display only)
    domain/enums.ts                         # TS unions mirrored from pgEnums (generated types)
    env/client-env.ts
  web/
    api/eden.ts                             # treaty<App>(location.origin).api — browser only
    api/use-consultation-stream.ts          # SSE hook: abort on unmount, reconnect with backoff
    features/signup/…  features/consultation/…  features/backoffice/…   # feature components/hooks
  components/ui/**                          # vendored shadcn (Base UI) — CLI-owned
  routes/                                   # TanStack file routes (see frontend.md)
  styles.css  theme.css                     # theme.css = the only token file (swappable)
scripts/ops/{doctor,up,prune,deploy,migrate,hash-password}.ts  scripts/ops/lib/*.ts
compose.yaml  Dockerfile  Caddyfile  .env.example
drizzle/                                    # drizzle-kit 1.0 migrations (<timestamp>_<name>/migration.sql)
```

## Names that must agree across slices

| Thing           | Name                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| Lender codes    | `ALFA` `BETA` `GAMA` `DELTA` (pgEnum `lender_code`; URL segment lowercase `alfa`…)         |
| Lender queues   | `lender.alfa` `lender.beta` `lender.gama` `lender.delta` (`retryLimit: 0`, `notify: true`) |
| Finalizer queue | `consultation.finalize` (`retryLimit: 3`; it's idempotent)                                 |
| Purge schedule  | `throttle.purge`, cron `*/15 * * * *`                                                      |
| NOTIFY channel  | `consultation_updated`, payload = consultation id (uuid text)                              |
| SSE event names | `snapshot` (data: `ConsultationPublicView`), `ping` (every 15 s, data: `null`)             |
| Cookie          | `bo_session` (Elysia signed)                                                               |
| Headers         | `Idempotency-Key` (request), `X-Forwarded-For` / `X-Real-IP` (set by Caddy)                |
| Error codes     | see `api.md` § Errors                                                                      |

## Allowed dependency directions

`routes/job/plugin` → `service` → `repository` → `db/client`. Services may call other modules' services, never their repositories. `*.schemas.ts`, `shared/**` and pure files (`price.ts`, `circuit-breaker.ts`, `consultation-view.ts`, `scenario.ts`) import no DB client, no `node:*`, no env. Browser code (`web/**`, `routes/**`, `components/**`) imports server code only as `import type`, plus `*.schemas.ts` and `shared/**`.
