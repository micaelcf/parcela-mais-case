# S5 — one command brings the stack up on Podman or Docker, and deploy/prune/doctor are safe and local · ~16 files · est. ~8k

Wave 2. Owns: `compose.yaml`, `Dockerfile`, `.dockerignore`, `Caddyfile`, `.env.example`, `scripts/ops/{doctor,up,prune,deploy,hash-password}.ts`, `scripts/ops/lib/**`, `src/server/modules/backoffice/auth/password.ts`, `src/server/modules/backoffice/auth/password.test.ts`, `package.json` (`scripts` block only, this wave)
Reads: contract/bindings.md, contract/layout.md, contract/ops.md, contract/signatures.md

Non-goals: no remote host, SSH, `git fetch/pull/push`, registry push, or TLS issuance flow beyond Caddy's own. `scripts/ops/lib/*.ts` is pure and Node-safe (no `bun` import) so `vp test` can import it; the entry scripts inject Bun Shell into it. `scripts/ops/migrate.ts` already exists (S1); reuse it. The worker entry is `src/server/worker.main.ts` (S4, landing in parallel: reference the path, don't create it).

**C77** · RF-710 — the ops command runner refuses `ssh`, `scp`, `sftp`, `rsync`, `git fetch|pull|push|clone|remote|ls-remote`, any `-H`/`--host`/`--url`/`--connection` engine flag and a `DOCKER_HOST`/`CONTAINER_HOST` env override, and allows the engine, `git status|rev-parse`, `bun` and `vp`
Proof: `vp test scripts/ops/lib/run.test.ts -t "refuses remote-capable commands"`

**C78** · RF-706 — the deploy plan stops with a non-zero exit when `git status --porcelain` prints anything, before any build command runs
Proof: `vp test scripts/ops/lib/deploy-plan.test.ts -t "refuses a dirty working tree before building"`

**C79** · RF-708 — the deploy plan fails when `/api/health` returns a `sha` different from `git rev-parse HEAD`, and passes `GIT_SHA` to the build
Proof: `vp test scripts/ops/lib/deploy-plan.test.ts -t "fails when the health sha differs"`

**C80** · RF-709 — after a healthy deploy the plan removes images labelled `com.parcela.project=parcela-mais-case` that no current service uses, then the build cache; after an unhealthy one it removes nothing
Proof: `vp test scripts/ops/lib/deploy-plan.test.ts -t "cleans superseded images only after a healthy deploy"`

**C81** · RF-707 — with a deliberately failing migration committed in a scratch clone, `vp run deploy` exits non-zero and the `app` and `worker` containers are never started (`<engine> ps -a` shows them absent or `Created`)
Proof: `log.md` § S5 "RF-707 failed-migration deploy run"

**C82** · RF-704 — `doctor` flags a `DATABASE_URL` whose host is `127.0.0.1`, a Bun version other than 1.4.4, and a missing compose provider, each as ✗ with a fix hint
Proof: `vp test scripts/ops/lib/doctor-checks.test.ts -t "flags each failed readiness check with a hint"`

**C83** · RF-704 — a `vp run doctor` run leaves `git status --porcelain`, the project's container list and its volume list identical before and after
Proof: `log.md` § S5 "RF-704 doctor read-only run"

**C84** · RF-705 — the prune plan only targets compose project `parcela-mais-case` and its labelled images locally, and accepts no host/remote option (unknown flags exit non-zero)
Proof: `vp test scripts/ops/lib/prune-plan.test.ts -t "targets only this project locally"`

**C85** · RF-701 — `vp run up` brings Postgres healthy, applies migrations, and serves `GET http://localhost:3000/api/health` → 200 with the worker process running
Proof: `log.md` § S5 "RF-701 up run"

**C86** · RF-702 — `vp run up --prod` reports `caddy`, `app`, `worker` and `postgres` healthy (migrate exited 0), prints the URL, and `GET http://localhost:${HTTP_PORT}/api/health` → 200 through Caddy
Proof: `log.md` § S5 "RF-702 up --prod run (podman)"

**C87** · RF-703 — the RF-702 run also passes with `CONTAINER_ENGINE=docker`
Proof: `log.md` § S5 "RF-703 up --prod run (docker)"

**C88** · RF-601 — `hashPassword` output matches `scrypt$16384$8$1$<saltB64>$<hashB64>`; `verifyPassword` accepts the password, rejects another, and returns false on a malformed value
Proof: `vp test src/server/modules/backoffice/auth/password.test.ts -t "hashes and verifies scrypt passwords"`
