import { verifyPassword } from "#/server/modules/backoffice/auth/password";

import { compose, devCompose, type Engine } from "./engine";
import {
  checkHealth,
  DEFAULT_APP_DOMAIN,
  type HealthFetch,
  type HealthResult,
  healthRequest,
  proxySite,
  type Sleep,
  siteOrigin,
} from "./health";
import { DEV_CA_ROOT, DEV_CADDY_DATA, type LocalCa, waitForCa } from "./local-ca";
import { checkProxyHealth, type ProxyDeps } from "./proxy";
import type { Env, RunCommand } from "./run";

export type UpMode = "dev" | "prod";

export function parseUpArgs(
  args: readonly string[],
): { ok: true; mode: UpMode } | { ok: false; error: string } {
  if (args.length === 0) return { ok: true, mode: "dev" };
  if (args.length === 1 && args[0] === "--prod") return { ok: true, mode: "prod" };
  return { ok: false, error: `unknown option(s): ${args.join(" ")} (up takes only --prod)` };
}

/**
 * Dev: Postgres healthy (host port from `compose.dev.yaml`) and caddy-dev (https://parcela.localhost,
 * proxying the host's `vp dev`), then migrations; app and worker follow.
 */
export function devSetupPlan(engine: Engine): string[][] {
  return [
    devCompose(engine, "up", "-d", "--wait", "postgres", "caddy-dev"),
    ["bun", "scripts/ops/migrate.ts"],
  ];
}

/** The dev foreground processes, each with its log prefix; `vp dev` listens only on `listen`. */
export function devProcesses(
  listen: string,
): ReadonlyArray<{ readonly name: string; readonly argv: readonly string[] }> {
  return [
    { name: "app", argv: ["vp", "dev", "--port", "3000", "--host", listen] },
    { name: "worker", argv: ["bun", "--watch", "src/server/worker.main.ts"] },
  ];
}

export async function runDevSetup(deps: {
  run: RunCommand;
  engine: Engine;
  /** Merged into compose's env (DEV_UPSTREAM_HOST). */
  composeEnv: Env;
  log(line: string): void;
}): Promise<number> {
  for (const argv of devSetupPlan(deps.engine)) {
    if ((await deps.run(argv, { env: deps.composeEnv })).exitCode !== 0) {
      deps.log(`✗ ${argv.join(" ")} failed`);
      if (argv.includes("caddy-dev"))
        deps.log(
          "  ports busy? `vp run up --prod` publishes the same ones: `vp run down` first, then `vp run doctor`",
        );
      return 1;
    }
  }
  return 0;
}

/** `/api/health` of the dev stack through caddy-dev, verified against its CA (first request compiles). */
export function checkDevHealth(deps: {
  fetch: HealthFetch;
  sleep: Sleep;
  env: Env;
  ca: LocalCa | null;
}): Promise<HealthResult> {
  const site = proxySite({ APP_DOMAIN: DEFAULT_APP_DOMAIN, HTTPS_PORT: deps.env.HTTPS_PORT });
  const { url, init } = healthRequest(site, deps.ca?.pem);
  return checkHealth({ url, init, fetch: deps.fetch, sleep: deps.sleep, attempts: 120 });
}

export function devOrigin(env: Env): string {
  return siteOrigin(proxySite({ APP_DOMAIN: DEFAULT_APP_DOMAIN, HTTPS_PORT: env.HTTPS_PORT }));
}

/** The dev operator password: what `.env.example`'s hash encodes and the tests log in with. */
export const DEV_BACKOFFICE_PASSWORD = "senha-de-teste";

/**
 * Where to log in. The password is printed only in dev, and only when the configured hash is the
 * documented dev one; `--prod` and `deploy` never print it.
 */
export async function backofficeLines(input: {
  origin: string;
  env: Env;
  showDevPassword: boolean;
}): Promise<string[]> {
  const { origin, env } = input;
  const lines = [
    `  backoffice: ${origin}/backoffice`,
    `  usuário: ${env.BACKOFFICE_USERNAME ?? "defina BACKOFFICE_USERNAME"}`,
  ];
  if (!input.showDevPassword) return lines;
  const hash = env.BACKOFFICE_PASSWORD_HASH ?? "";
  lines.push(
    (await verifyPassword(DEV_BACKOFFICE_PASSWORD, hash))
      ? `  senha: ${DEV_BACKOFFICE_PASSWORD}`
      : "  senha: a definida em BACKOFFICE_PASSWORD_HASH (.env.local)",
  );
  return lines;
}

/** Trusts a local CA root saved at `file` (local-ca.ts `ensureTrusted`); false when it isn't. */
export type TrustCa = (ca: LocalCa, file: string) => Promise<boolean>;

/**
 * Compose env of `vp run up --prod`: the prod `caddy` mounts caddy-dev's data dir, so both serve
 * the one local CA this machine already trusts. `deploy` never sets it (named volume, ACME).
 */
export const PROD_PARITY_COMPOSE_ENV = { CADDY_DATA: `./${DEV_CADDY_DATA}` } as const;

/**
 * Prod parity: build and start the `prod` profile (removing caddy-dev, which holds the same
 * ports), check health through Caddy over TLS verified against the shared local CA, make sure the
 * OS trusts that CA (silent when `vp run up` already did), print the URLs.
 */
export async function runProdUp(
  deps: ProxyDeps & {
    /** A file's content, or null when it doesn't exist. */
    readFile(path: string): Promise<string | null>;
    trust: TrustCa;
  },
): Promise<number> {
  const up = compose(
    deps.engine,
    "--profile",
    "prod",
    "up",
    "-d",
    "--build",
    "--wait",
    "--remove-orphans",
  );
  if ((await deps.run(up, { env: PROD_PARITY_COMPOSE_ENV })).exitCode !== 0) {
    deps.log("✗ the prod stack did not come up healthy");
    return 1;
  }
  const health = await checkProxyHealth(deps, () =>
    waitForCa(() => deps.readFile(DEV_CA_ROOT), deps.sleep),
  );
  if (!health.ok) {
    deps.log(`✗ ${health.reason}`);
    return 1;
  }
  if (health.ca) await deps.trust(health.ca, DEV_CA_ROOT);
  deps.log(`✓ caddy, app, worker and postgres are healthy (sha ${health.sha})`);
  deps.log(`→ ${health.origin}`);
  for (const line of await backofficeLines({
    origin: health.origin,
    env: deps.env,
    showDevPassword: false,
  }))
    deps.log(line);
  return 0;
}

/** Splits a byte stream into lines and writes each with `prefix`; `flush` emits a trailing partial line. */
export function createLinePrefixer(prefix: string, write: (text: string) => void) {
  let pending = "";
  return {
    push(chunk: string): void {
      const parts = (pending + chunk).split(/\r?\n/);
      pending = parts.pop() ?? "";
      for (const line of parts) write(`${prefix}${line}\n`);
    },
    flush(): void {
      if (pending !== "") write(`${prefix}${pending}\n`);
      pending = "";
    },
  };
}
