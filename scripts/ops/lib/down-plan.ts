import { devCompose, type Engine } from "./engine";
import type { RunCommand } from "./run";

/** `down` removes the containers and network; `stop` only stops them. Neither touches data. */
export type DownMode = "down" | "stop";

const MODE_ARGS: Record<DownMode, readonly string[]> = {
  down: ["down", "--remove-orphans"],
  stop: ["stop"],
};

const MODE_DONE: Record<DownMode, string> = {
  down: "✓ parcela-mais-case down: containers and network removed; data volume kept",
  stop: "✓ parcela-mais-case stopped: containers kept; data volume kept",
};

/** No options but `--stop`: nothing here can choose volumes, images, another project or a host. */
export function parseDownArgs(
  args: readonly string[],
): { ok: true; mode: DownMode } | { ok: false; error: string } {
  if (args.length === 0) return { ok: true, mode: "down" };
  if (args.length === 1 && args[0] === "--stop") return { ok: true, mode: "stop" };
  return { ok: false, error: `unknown option(s): ${args.join(" ")} (down takes only --stop)` };
}

/**
 * Takes this compose project down without losing anything: dev Postgres and caddy-dev (both from
 * `compose.dev.yaml`, so `--stop` reaches caddy-dev too) and, when running, the prod-parity
 * services (`--profile prod`). Never `-v` or `--rmi`: the database volume, caddy's CA and the
 * built images stay, so `vp run up` resumes with the same data. `vp run prune` is the reset.
 */
export function downPlan(engine: Engine, mode: DownMode): string[][] {
  return [devCompose(engine, "--profile", "prod", ...MODE_ARGS[mode])];
}

export async function runDown(
  deps: { run: RunCommand; engine: Engine; log(line: string): void },
  args: readonly string[],
): Promise<number> {
  const parsed = parseDownArgs(args);
  if (!parsed.ok) {
    deps.log(`✗ ${parsed.error}`);
    return 2;
  }
  for (const argv of downPlan(deps.engine, parsed.mode)) {
    if ((await deps.run(argv)).exitCode !== 0) {
      deps.log(`✗ ${argv.join(" ")} failed`);
      return 1;
    }
  }
  deps.log(MODE_DONE[parsed.mode]);
  deps.log("– the app and worker of `vp run up` run in your terminal: stop them with Ctrl-C there");
  return 0;
}
