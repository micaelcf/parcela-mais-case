# Stack baseline (verified 2026-10-27)

Ground truth about the template and toolchain as they existed before `pre-approval-journey` work began. Every line is cited; re-verify before relying on it after dependency changes.

## Template state

| Fact                                                                                                        | Anchor                                      |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| TanStack Start `1.169.4`, React Router `1.170.46`, React 19, TanStack Form `1.33.5`, TanStack Table `9.3.1` | `package.json:20-38`                        |
| Vite+ `1.3.0`; `vite` aliased to `@voidzero-dev/vite-plus-core@1.3.0`                                       | `package.json:54-58`                        |
| nitro `3.0.260610-beta` as the server build plugin                                                          | `package.json:33`, `vite.config.ts:9,24`    |
| Drizzle `0.45.1` on `pg` (node-postgres); `db` built from `process.env.DATABASE_URL`                        | `package.json:31-34`, `src/db/index.ts:1-5` |
| Only schema: example `todos` table                                                                          | `src/db/schema.ts:3-7`                      |
| Env via `@t3-oss/env-core` + zod; `runtimeEnv: import.meta.env`                                             | `src/env.ts:1-39`                           |
| Path aliases `#/*` and `@/*` → `./src/*` (tsconfig); `#/*` also in package `imports`                        | `tsconfig.json:7-10`, `package.json:5-7`    |
| Lint is type-aware with type checking; `vite-plus/prefer-vite-plus-imports` is an error                     | `vite.config.ts:16-20`                      |
| Pre-commit runs `vp check --fix` on staged files                                                            | `vite.config.ts:12-14`                      |
| Package manager pinned: Bun `1.4.4` via `devEngines`                                                        | `package.json:60-66`                        |
| Vercel target configured (`framework: tanstack-start`), scaffolded with the `vercel` add-on                 | `vercel.json:1-4`, `.cta.json:21`           |
| Not installed: Elysia, Eden, pg-boss, Base UI, shadcn, TypeBox                                              | `package.json`                              |

## Toolchain facts

- `vp` manages **one Node.js runtime**; Bun is a package-manager family, not the runtime of `vp dev`/`vp test` (`node_modules/vite-plus/docs/guide/env.md:3`).
- `vp` built-ins: create, migrate, dev, build, test, lint, fmt/format, check, pack, run, exec, preview, cache, config, hooks, staged, toolchain, install (`vp help`). Scripts can't override built-ins; run them with `vp run <name>` (`docs/guide/run.md:43-56`).
- `vite.config.ts` tasks are cached by default; `package.json` scripts are not (`docs/guide/run.md:114-117`).

## External facts the decisions rest on

- Elysia v2 mounts in TanStack Start via `src/routes/api.$.ts` → `app.fetch(request)`; Eden via `treaty` (next.elysiajs.com/integrations/tanstack-start).
- Elysia v2 recommends `drizzle-orm@rc` + `drizzle-orm/typebox` (TypeBox 1.x) and warns against the legacy `drizzle-typebox` (github.com/elysiajs/skills `elysia/references/drizzle.md`).
- Elysia handler tests use `app.handle(new Request(absoluteUrl))` or Eden `treaty(app)` without opening a port (next.elysiajs.com/patterns/unit-test).
- pg-boss: depends on `pg`, `engines.node >=22.12`; supports `db.executeSql` adapters, transactional `send({ db })`, `useListenNotify` (needs a session-pinned connection, not PgBouncer transaction mode); scheduling and maintenance need a live instance (pgboss.io).
- Drizzle v1 removes v0 `relations()`/RQBv1 in favor of `defineRelations`/`defineRelationsPart` (orm.drizzle.team v0→v1 docs).
- TypeBox does not implement Standard Schema natively; an adapter is required for Standard Schema consumers (typebox discussion #1152).
- **Verified under Node v25.9.0 (2026-10-27, throwaway dir):** `elysia@2.0.0-rc.0`, `@elysia/eden@2.0.0-rc.0`, `drizzle-orm@1.0.0-rc.5` (`drizzle-orm/typebox`) and `typebox@1.4.3` work together. `app.handle(Request)` returned 200/422 against a generated insert schema, and `treaty(app)` returned typed data. npm dist-tags: `drizzle-orm`/`drizzle-kit` `rc` = `1.0.0-rc.5` (latest stable 0.45.4 / 0.31.11); `elysia` `rc` = `2.0.0-rc.0` (latest 1.4.30).
- **Elysia 2 route signature is `(path, hook, handler)`**; the 1.x order `(path, handler, hook)` throws at registration ("is the 1.x order").
- **TypeBox 1.4.3 `Value.Errors`** yields `{ instancePath: '/patient/cpf', keyword, message }` with English default messages, which is the input for the shared Standard Schema adapter.

## Verified in Stage 3 discovery (2026-10-27)

- **Workstation:** podman 6.0.2 (rootless, WSL machine), `podman compose` → docker-compose v5.1.3; bun 1.4.4; node 25.9.0. Published container ports answer on `localhost`/`::1`, **not** on `127.0.0.1` (TCP probe).
- **Vite+ tests:** import from `vite-plus/test` (Vitest 5.0.5 re-export); `vitest` imports fail the `vite-plus/prefer-vite-plus-imports` lint error (`vite.config.ts:18`, `node_modules/vite-plus/docs/guide/test.md:13-16`).
- **Gate baseline:** `vp check` is red on the untouched template: oxfmt flags `src/routeTree.gen.ts`, and the type check flags `drizzle.config.ts:6` (TS2345, `url: string | undefined`).
- **Vite env:** in server builds, unprefixed `import.meta.env.*` is inlined as `void 0`; `process.env` survives (`keepProcessEnv` for server consumers). `src/env.ts:23` is therefore broken for server vars.
- **TanStack Start 1.169.4:** `defaultSsr: false` (router option, `router-core/src/router.ts:448`) makes route content client-only while `shellComponent` still renders the document; server routes are matched first (`start-server-core/src/createStartHandler.ts:1186-1205`).
- **Elysia 2.0.0-rc.0:** SSE requires `yield sse(...)` (plain-object generators stream concatenated JSON); Eden yields `{ id?, event?, data }` envelopes, has no reconnect, and doesn't cancel on `break`; native signed cookies (`cookie: { secrets, sign }`); production 422 bodies omit field details; `server` is `null` under `app.fetch`; `typebox` is a peer (one instance shared with `drizzle-orm/typebox`).
- **drizzle 1.0.0-rc.5:** `drizzle({ client, relations })` (no `schema` key); `defineRelationsPart` works per file if every relation has explicit `from`/`to`; migrations in `drizzle/<timestamp>_<name>/`; `numeric` → string; `bigint({mode:"bigint"})` isn't JSON-serialisable through Elysia; `timestamp` → `Date` schema rejects ISO strings in bodies.
- **pg-boss 12.38.0:** `fromDrizzle(tx, sql)` joins node-postgres drizzle transactions (rollback drops the job); `pg_notify` inside a TX is delivered on commit only; `work()` handlers receive arrays; queues must exist before `send`/`schedule`.
- **TypeBox 1.4.3:** no per-schema `errorMessage`; ships a `pt_BR` locale; `Type.Refine` is enforced by Elysia and by `Compile`; `required` errors are reported on the parent; `maxErrors` defaults to 8.
