# S5 — one command brings the stack up on Podman or Docker, and deploy/prune/doctor are safe and local · ~16 files · est. ~8k

Wave 2. Owns: `compose.yaml`, `Dockerfile`, `.dockerignore`, `Caddyfile`, `.env.example`, `scripts/ops/{doctor,up,prune,deploy,hash-password}.ts`, `scripts/ops/lib/**`, `src/server/modules/backoffice/auth/password.ts`, `src/server/modules/backoffice/auth/password.test.ts`, `package.json` (`scripts` block only, this wave)
Except: `compose.yaml` already exists with the `postgres` service (lead, W0, so the integration harness had a database); this slice extends it and owns it from here.
Reads: contract/bindings.md, contract/layout.md, contract/ops.md, contract/signatures.md

Non-goals: no remote host, SSH, `git fetch/pull/push`, registry push, or TLS issuance flow beyond Caddy's own. `scripts/ops/lib/*.ts` is pure and Node-safe (no `bun` import) so `vp test` can import it; the entry scripts inject Bun Shell into it. `scripts/ops/migrate.ts` already exists (S1); reuse it. The worker entry is `src/server/worker.main.ts` (S4, landing in parallel: reference the path, don't create it).

**C77** · RF-710 — the ops command runner refuses `ssh`, `scp`, `sftp`, `rsync`, `git fetch|pull|push|clone|remote|ls-remote`, any `-H`/`--host`/`--url`/`--connection` engine flag and a `DOCKER_HOST`/`CONTAINER_HOST` env override, and allows the engine, `git status|rev-parse`, `bun` and `vp`
Proof: `vp test scripts/ops/lib/run.test.ts -t "refuses remote-capable commands"`

**C78** · RF-706 — the deploy plan stops with a non-zero exit when `git status --porcelain` prints anything, before any build command runs
Proof: `vp test scripts/ops/lib/deploy-plan.test.ts -t "refuses a dirty working tree before building"`

**C79** · RF-708 — the deploy plan fails when `/api/health` returns a `sha` different from `git rev-parse HEAD`, and passes `GIT_SHA` to the build
Proof: `vp test scripts/ops/lib/deploy-plan.test.ts -t "fails when the health sha differs"`

**C80** · RF-709 — after a healthy deploy the plan removes images labelled `com.parcela.project=parcela-mais-case` that no current service uses, then (Podman only; skipped and reported on Docker, amended 2026-10-28, audit A7) the build cache; after an unhealthy one it removes nothing
Proof: `vp test scripts/ops/lib/deploy-plan.test.ts -t "cleans superseded images only after a healthy deploy"`

**C165** · RF-702 — the prod and deploy plans load only compose files in which Caddy is the one service publishing host ports and no environment value holds a literal credential (added 2026-10-28, audit A2)
Proof: `vp test scripts/ops/lib/compose-stack.test.ts -t "publishes only caddy and holds no literal credential in the prod stack"`

**C166** · RF-701 — the dev flow's compose files publish Postgres with the credentials `.env.example` connects with (added 2026-10-28, audit A2)
Proof: `vp test scripts/ops/lib/compose-stack.test.ts -t "publishes Postgres for the dev flow with the credentials .env.example connects with"`

**C167** · RF-702, RF-703 — no compose file loaded by `up`, `up --prod`, `deploy` or `prune` nests a `${…}` inside a default value (podman-compose ≤ 1.5 mis-parses it) (added 2026-10-28, audit N1)
Proof: `vp test scripts/ops/lib/compose-stack.test.ts -t "never nests an interpolation inside a default"`

**C208** · RF-711 — `vp run down` runs exactly `compose -f compose.yaml -p parcela-mais-case --profile prod down --remove-orphans` (`--stop` → `… stop`); no plan argument ever deletes volumes or images or leaves the project; `-v`, `--volumes`, `--rmi`, a host or any other option exits 2 with nothing run; a compose failure exits 1 (added 2026-10-28, user request)
Proof: `vp test scripts/ops/lib/down-plan.test.ts`

Local HTTPS (added 2026-10-28, user request, RFC D31):

**C209** · RF-701, RF-702 — Caddy listens on the ports it publishes in both stacks; `parcela.localhost` over HTTPS is the default site; dev keeps its CA in the `.local/caddy` bind mount, which `up --prod` shares through `CADDY_DATA` and `deploy` never sets
Proof: `vp test scripts/ops/lib/compose-stack.test.ts -t "Caddy"`

**C210** · RF-701 — the trust plan per platform: Windows user Root store by fingerprint, macOS login keychain, Linux NSS user db plus every Firefox profile without sudo, the package hint without `certutil`; already trusted → silent and unchanged; a declined prompt warns with the manual command and doesn't fail
Proof: `vp test scripts/ops/lib/local-ca.test.ts`

**C211** · RF-701 — `up` starts Postgres and caddy-dev pointed at the dev server's address and checks health on loopback with SNI/Host `parcela.localhost` against the local CA
Proof: `vp test scripts/ops/lib/up-plan.test.ts -t "dev stack"`

**C212** · RF-701, RF-702 — `up` prints the dev password only when the configured hash verifies against the documented one (which `.env.example`'s hash does), never outside dev
Proof: `vp test scripts/ops/lib/up-plan.test.ts -t "backoffice login lines"`

**C213** · RF-712 — the dev server never listens on every interface; per OS and engine it binds the address the proxy reaches (only Linux + rootless Podman lands on a shared network, flagged), and the lender simulator URL follows it unless configured elsewhere
Proof: `vp test scripts/ops/lib/dev-binding.test.ts`

**C214** · RF-704 — `doctor` checks the CA's trust, Caddy's ports, `parcela.localhost` resolution, caddy-dev's route to the dev server and where it listens, and the Linux port floor for an opt-in `HTTPS_PORT=443`
Proof: `vp test scripts/ops/lib/doctor-checks.test.ts`

**C215** · RF-711 — `down` covers caddy-dev too
Proof: `vp test scripts/ops/lib/down-plan.test.ts -t "caddy-dev"`

**C216** · RF-701, RF-702, RF-712 — live on Windows + Podman: `vp run up` serves `https://parcela.localhost:8443` over TLS verified against the local CA, redirects `http://parcela.localhost:8080` to it, refuses the dev server and proxy on the LAN/VPN addresses, and the full E2E suite passes over it; `up --prod` reuses the CA without a new prompt and the proxy spec passes against it
Proof: `vp run up`, then `bunx vp run e2e`; `vp run up --prod`, then `E2E_BASE_URL=https://parcela.localhost:8443 bunx vp run e2e test/e2e/proxy.spec.ts` (macOS/Linux unverified live)

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

**C88** · RF-601 — `hashPassword` output matches `scrypt:16384:8:1:<saltB64>:<hashB64>`; `verifyPassword` accepts the password, rejects another, and returns false on a malformed value
Proof: `vp test src/server/modules/backoffice/auth/password.test.ts -t "hashes and verifies scrypt passwords"`

Logging (added 2026-10-28, user request, RFC D35):

**C237** · RF-713 — each dev process gets its own prefix colour, and coloured or not every prefix ends in the same column
Proof: `vp test scripts/ops/lib/up-plan.test.ts -t "give each process its own colour"`
