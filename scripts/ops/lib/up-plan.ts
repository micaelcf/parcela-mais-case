import { compose, devCompose, type Engine } from "./engine";
import { checkHealth, type HealthFetch, healthUrl, type Sleep } from "./health";
import type { RunCommand } from "./run";

export type UpMode = "dev" | "prod";

export function parseUpArgs(
  args: readonly string[],
): { ok: true; mode: UpMode } | { ok: false; error: string } {
  if (args.length === 0) return { ok: true, mode: "dev" };
  if (args.length === 1 && args[0] === "--prod") return { ok: true, mode: "prod" };
  return { ok: false, error: `unknown option(s): ${args.join(" ")} (up takes only --prod)` };
}

/** Dev: Postgres healthy (host port from `compose.dev.yaml`), then migrations; app and worker follow. */
export function devSetupPlan(engine: Engine): string[][] {
  return [devCompose(engine, "up", "-d", "--wait", "postgres"), ["bun", "scripts/ops/migrate.ts"]];
}

/** The dev foreground processes, each with its log prefix. */
export const DEV_PROCESSES: ReadonlyArray<{
  readonly name: string;
  readonly argv: readonly string[];
}> = [
  { name: "app", argv: ["vp", "dev", "--port", "3000"] },
  { name: "worker", argv: ["bun", "--watch", "src/server/worker.main.ts"] },
];

export async function runDevSetup(deps: {
  run: RunCommand;
  engine: Engine;
  log(line: string): void;
}): Promise<number> {
  for (const argv of devSetupPlan(deps.engine)) {
    if ((await deps.run(argv)).exitCode !== 0) {
      deps.log(`✗ ${argv.join(" ")} failed`);
      return 1;
    }
  }
  return 0;
}

/** Prod parity: build and start the `prod` profile, wait for health through Caddy, print the URL. */
export async function runProdUp(deps: {
  run: RunCommand;
  engine: Engine;
  fetch: HealthFetch;
  sleep: Sleep;
  httpPort: string;
  log(line: string): void;
}): Promise<number> {
  const up = compose(deps.engine, "--profile", "prod", "up", "-d", "--build", "--wait");
  if ((await deps.run(up)).exitCode !== 0) {
    deps.log("✗ the prod stack did not come up healthy");
    return 1;
  }
  const url = healthUrl(deps.httpPort);
  const health = await checkHealth({ url, fetch: deps.fetch, sleep: deps.sleep });
  if (!health.ok) {
    deps.log(`✗ ${url} is not healthy: ${health.reason}`);
    return 1;
  }
  deps.log(`✓ caddy, app, worker and postgres are healthy (sha ${health.sha})`);
  deps.log(`→ http://localhost:${deps.httpPort}`);
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
