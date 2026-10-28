# Layout and naming

Two trees with different rules, plus one isomorphic library between them:

| Tree                   | What it is                                           | Organised by                                                                                                                     |
| ---------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/`          | The API and the worker. Never shipped to the browser | DDD: `infra/` (our infrastructure), `integrations/` (external systems), `modules/` (business features)                           |
| frontend (`src/` root) | The React app, no SSR                                | TanStack Start + shadcn conventions: `routes/`, `api/`, `hooks/`, `components/` (shell + `ui/`), `components/modules/<feature>/` |
| `src/lib/`             | Isomorphic code both trees import                    | One folder per concern. No `node:*`, no env, no DB, no React                                                                     |

## API tree (`src/server/`, DDD)

| Folder                 | Meaning                                                                                                                             | May import                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `server/` root files   | Composition roots: `app.ts` (HTTP) and `worker.ts` (worker process). The only files that import every module                        | everything under `server/`                                     |
| `server/infra/`        | Infrastructure we run: env, Postgres, HTTP server plumbing, queue, jobs/worker runtime, realtime. Never imports a module            | `lib/**`, `server/lib/**`, other `infra/**`                    |
| `server/lib/`          | In-process server code that isn't infrastructure and isn't a business rule: crypto, logging, domain errors. Node-only (`node:*` ok) | `lib/**`, `infra/env`                                          |
| `server/integrations/` | Outbound adapters to systems we don't own. One folder per external system                                                           | `lib/**`, `server/lib/**`, `infra/env`                         |
| `server/modules/`      | Business features: routes → service → repository. The only home of business rules                                                   | `lib/**`, `server/lib/**`, `infra/**`, `integrations/**` ports |

```text
src/server/
  app.ts                                    # HTTP composition root: Elysia({ prefix: "/api" }) + plugins + module routes; export type App
  worker.ts                                 # worker composition root: createWorker(deps) registers every module job on infra/worker
  worker.main.ts                            # worker process entry: createWorker().start(), stop on SIGTERM/SIGINT
  infra/
    env/server-env.ts                       # validated server env (process.env)
    db/client.ts                            # pg.Pool + drizzle({ client, relations }) singleton; Db/Tx types
    db/enums.ts                             # every pgEnum, built from `lib/enums.ts` value lists
    db/schema.ts                            # barrel: re-exports every *.table.ts (tables only)
    db/relations.ts                         # { ...defineRelationsPart(schema), ...each *.relations.ts }
    db/uuid.ts                              # uuidv7() via node:crypto
    db/list-query.ts                        # offset/limit list engine (allow-lists → SQL)
    db/migrate.ts                           # drizzle migrate + pg-boss schema + queues/schedules (idempotent)
    http/errors.plugin.ts                   # onError → problem+json
    http/client-ip.ts                       # read the X-Forwarded-For Caddy sets
    queue/boss.ts                           # PgBoss singleton (own pool, max 3)
    queue/queues.ts                         # queue names + options (single source)
    worker/run-worker.ts                    # createWorker(registrations, deps): boss lifecycle, work() per queue, graceful stop
    realtime/consultation-events.ts         # one LISTEN client on `consultation_updated` + in-memory fan-out
  lib/
    crypto/cpf-crypto.ts                    # blind index + AES-256-GCM (the only node:crypto user for PII)
    crypto/ip-hash.ts                       # HMAC("ip:v1:" + ip)
    log/logger.ts                           # tslog: pretty in dev, one JSON line per event with TSLOG_TYPE=json
    errors/domain-error.ts                  # DomainError(code, status, detail?) mapped by infra/http/errors.plugin
  integrations/
    lenders/
      lender.port.ts                        # LenderPort + canonical result types + LENDER_CODES
      registry.ts                           # LenderCode → adapter
      alfa/alfa.adapter.ts  beta/beta.adapter.ts  gama/gama.adapter.ts  delta/delta.adapter.ts
      simulator/                            # stand-in for the four external lenders
        simulator.plugin.ts                 # Elysia plugin at /simulator/lenders
        scenario.ts                         # scenario → per-lender behaviour (pure)
      alfa.simulator.ts … delta.simulator.ts
    viacep/
      viacep.adapter.ts                     # GET {VIACEP_BASE_URL}/ws/{cep}/json/ → found | not_found | unavailable (RFC D27). Never name server files `*.client.*`/`*.server.*`: TanStack Start's import protection stubs `*.client.*` in the server build
  modules/
    consultation/
      db/consultation.table.ts              db/consultation.relations.ts
      consultation.dto.ts                   # request/response DTOs (TypeBox, drizzle-derived) + pure rows → ConsultationPublicView; web imports it
      consultation.repository.ts
      consultation.service.ts               # create, requote, choose, read view, finalize, limits
      consultation.routes.ts                # public routes + SSE
    patient/
      db/patient.table.ts                   db/patient.relations.ts
      patient.repository.ts                 patient.service.ts        # upsert by cpf_hmac (incl. the normalised address)
    address/
      address.routes.ts                     # GET /addresses/:cep (throttle route `address.lookup`)
      address.service.ts                    # ViaCEP lookup + bounded in-process cache
    lender/                                 # our side of lending: attempts, breaker, kill switch
      db/lender-attempt.table.ts            db/lender-attempt.relations.ts
      db/lender-setting.table.ts            db/lender-switch-log.table.ts
      circuit-breaker.ts                    # pure derivation over attempt rows
      lender-attempt.repository.ts          lender-attempt.service.ts  lender-attempt.job.ts
      lender-setting.repository.ts          lender-setting.service.ts
    pricing/
      db/offer.table.ts                     db/offer.relations.ts
      price.ts                              # pure Tabela Price, exact rational BigInt
      pricing.service.ts                    offer.repository.ts
    throttle/
      db/request-throttle.table.ts
      throttle.plugin.ts                    throttle.repository.ts  throttle.service.ts  throttle-purge.job.ts
    backoffice/
      auth/backoffice-auth.plugin.ts        auth/password.ts
      backoffice.dto.ts                     # request/response DTOs + pure rows → detail/list item mappers
      backoffice.routes.ts                  metrics.repository.ts   metrics.service.ts
    system/system.routes.ts                 # GET /health, GET /config
```

Dependency direction: `routes/job/plugin` → `service` → `repository` → `infra/db/client`. Services may call other modules' services, never their repositories. Modules reach a lender only through `integrations/lenders/lender.port.ts` + `registry.ts`. `infra/**` and `server/lib/**` never import `modules/**`; only the composition roots (`app.ts`, `worker.ts`) do. Pure files (`price.ts`, `circuit-breaker.ts`, `scenario.ts`) and every `*.dto.ts` import no DB client, no `node:*`, no env (a `*.dto.ts` may import its module's `db/*.table.ts` for drizzle-typebox derivation, nothing else server-side).

## Frontend tree (TanStack Start + shadcn conventions)

```text
src/
  router.tsx                                # createRouter({ routeTree, defaultSsr: false, … })
  routes/                                   # file routes: path, search validation, loader/beforeLoad, page composition
    __root.tsx                              # static shell (html lang="pt-BR", HeadContent, Scripts); no data
    api.$.ts                                # server route: mounts src/server/app.ts (the only route touching server code at runtime)
    index.tsx  consultas.$consultationId.tsx  cadastro/  backoffice/   # directories only for parents with ≥ 2 nested routes (see frontend.md § Routes)
  api/                                      # browser data access (the only frontend code that calls the API)
    eden.ts                                 # treaty<App>(location.origin).api
    consultations.ts  backoffice.ts         # typed fetchers/mutations used by loaders and event handlers
  hooks/                                    # React hooks (shadcn `hooks` alias)
    use-consultation-stream.ts              # SSE: abort on unmount, reconnect with backoff
  components/                               # root = app shell and overall layout only
    ui/**                                   # vendored shadcn (Base UI), CLI-owned
    AppShell.tsx  BackofficeShell.tsx …     # public header/footer frame, backoffice nav frame
    modules/                                # feature components, grouped by feature
      signup/                               # SignupStepPatient.tsx …, signup-form.ts (createFormHook)
      consultation/                         # LenderCard.tsx, OfferList.tsx, NoOfferPanel.tsx …
      backoffice/                           # DataTable.tsx, PipelineChart.tsx, LenderHealthTable.tsx …
  styles.css  theme.css                     # theme.css = the only token file (swappable)
```

Data boundaries (TanStack Start, no SSR):

- **Routes own data.** A route's `loader`/`beforeLoad` calls `api/*` and passes results down; `validateSearch` owns URL state. Components read `Route.useLoaderData()`/props and never import `api/eden.ts`.
- **Exceptions, each named:** the live stream (`hooks/use-consultation-stream.ts`) and user-initiated mutations (submit, choose, requote, login, kill switch), which call `api/*` from event handlers and then `router.invalidate()` or `navigate`.
- Frontend code imports server code only as `import type` (`App`), plus `server/modules/*/*.dto.ts` (isomorphic DTOs) and `lib/**`.

## Isomorphic library (`src/lib/`)

```text
src/lib/
  utils.ts                                  # shadcn `cn()` (the `utils` alias the CLI expects)
  cpf/cpf.ts                                # normalize, check digits, CpfSchema refine
  money/money.ts                            # formatBRL (Intl), cents helpers (display only)
  validation/standard-schema.ts             # toStandardSchema(TypeBox) adapter
  validation/locale.ts                      # System.Locale pt_BR + keyword messages
  list/list-contract.ts                     # ListQuery / ListResponse TypeBox (API ↔ web format)
  enums.ts                                  # TS unions mirrored from the pgEnums
```

## Outside `src/`

```text
test/                                       # ONLY integration and E2E suites; unit tests sit next to the code they test
  integration/
    setup/global-setup.ts                   # per-run template DB: migrations + pg-boss schema + queues; drops test_<run>_* at teardown
    setup/file-db.setup.ts                  # per-file DB cloned from the template; sets DATABASE_URL before app imports
    setup/app-fetch.ts                      # appFetch + testLenderRegistry (signatures.md)
    consultation/*.int.test.ts  lender/*.int.test.ts  throttle/*.int.test.ts  backoffice/*.int.test.ts  infra/*.int.test.ts
  e2e/
    *.spec.ts                               # Playwright Test, final phase
scripts/ops/{doctor,up,down,prune,deploy,migrate,hash-password}.ts
scripts/ops/lib/*.ts                        # pure, Node-safe; unit tests co-located (*.test.ts)
compose.yaml  compose.dev.yaml  Dockerfile  Caddyfile  .env.example  playwright.config.ts  components.json
drizzle/                                    # drizzle-kit 1.0 migrations
```

Test placement: unit tests (`*.test.ts`) are co-located with the file they test, under `src/` or `scripts/`. Integration (`test/integration/**/*.int.test.ts`) and E2E (`test/e2e/*.spec.ts`) live only under `test/`, mirroring the module they exercise, and import app code through `#/*`.

## Naming

- Files are `kebab-case` with a role suffix: `*.table.ts`, `*.relations.ts`, `*.repository.ts`, `*.service.ts`, `*.routes.ts`, `*.dto.ts` (DTO schemas, types and pure row → DTO mappers), `*.adapter.ts`, `*.port.ts`, `*.job.ts`, `*.plugin.ts`, `*.simulator.ts`, `*.test.ts`, `*.int.test.ts`. React components are `PascalCase.tsx`; hooks are `use-*.ts`.
- No folder named `shared`, `common` or `helpers`: a folder names what its code is.

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
