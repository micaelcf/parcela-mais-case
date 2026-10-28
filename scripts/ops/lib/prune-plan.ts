import { compose, type Engine, pruneBuildCache, pruneDanglingProjectImages } from "./engine";
import type { RunCommand } from "./run";

/** `vp run prune` takes no options: there is no host, context or remote to choose (RF-705). */
export function parsePruneArgs(
  args: readonly string[],
): { ok: true } | { ok: false; error: string } {
  return args.length === 0
    ? { ok: true }
    : { ok: false, error: `unknown option(s): ${args.join(" ")} (prune takes none)` };
}

/**
 * Local reset of this project only: its containers, volumes, network and locally built images
 * (compose project `parcela-mais-case`), then its dangling labelled images, then its build cache
 * where the engine can scope it (Podman); `skipped` says what was left alone and why (Docker).
 */
export function prunePlan(engine: Engine): { commands: string[][]; skipped: string[] } {
  const cache = pruneBuildCache(engine);
  const commands = [
    compose(engine, "--profile", "prod", "down", "-v", "--remove-orphans", "--rmi", "local"),
    pruneDanglingProjectImages(engine),
  ];
  return "argv" in cache
    ? { commands: [...commands, cache.argv], skipped: [] }
    : { commands, skipped: [cache.skipped] };
}

export async function runPrune(
  deps: { run: RunCommand; engine: Engine; log(line: string): void },
  args: readonly string[],
): Promise<number> {
  const parsed = parsePruneArgs(args);
  if (!parsed.ok) {
    deps.log(`✗ ${parsed.error}`);
    return 2;
  }
  const plan = prunePlan(deps.engine);
  for (const argv of plan.commands) {
    if ((await deps.run(argv)).exitCode !== 0) {
      deps.log(`✗ ${argv.join(" ")} failed`);
      return 1;
    }
  }
  for (const note of plan.skipped) deps.log(`– ${note}`);
  deps.log(
    plan.skipped.length === 0
      ? "✓ parcela-mais-case reset (containers, volumes, project images, build cache)"
      : "✓ parcela-mais-case reset (containers, volumes, project images)",
  );
  return 0;
}
