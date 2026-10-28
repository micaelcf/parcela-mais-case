import { compose, PROJECT_LABEL, pruneBuildCache } from "./engine";
import { checkProxyHealth, type ProxyDeps, readContainerCa } from "./proxy";

/** `sha256:abc…` and `abc…` (full or truncated) name the same image. */
function sameImage(a: string, b: string): boolean {
  const x = a.replace(/^sha256:/, "");
  const y = b.replace(/^sha256:/, "");
  const length = Math.min(x.length, y.length);
  return length >= 12 && x.slice(0, length) === y.slice(0, length);
}

function lines(output: string): string[] {
  return [
    ...new Set(
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

/** Labelled project images that no current service container uses, then this project's build cache. */
async function removeSupersededImages(deps: ProxyDeps): Promise<boolean> {
  const { run, engine, log } = deps;
  const inUse = await run(compose(engine, "--profile", "prod", "images", "-q"), { quiet: true });
  if (inUse.exitCode !== 0) return false;
  const labelled = await run(
    [engine.bin, "images", "-q", "--no-trunc", "--filter", `label=${PROJECT_LABEL}`],
    { quiet: true },
  );
  if (labelled.exitCode !== 0) return false;

  const current = lines(inUse.stdout);
  const superseded = lines(labelled.stdout).filter(
    (id) => !current.some((used) => sameImage(id, used)),
  );
  if (superseded.length > 0) {
    log(`removing ${superseded.length} superseded project image(s)`);
    if ((await run([engine.bin, "rmi", ...superseded])).exitCode !== 0) return false;
  }
  const cache = pruneBuildCache(engine);
  if ("skipped" in cache) {
    log(`– ${cache.skipped}`);
    return true;
  }
  return (await run(cache.argv)).exitCode === 0;
}

/**
 * `vp run deploy`, run on the target host (RF-706…RF-709): refuse a dirty tree before anything
 * else, build with `GIT_SHA = HEAD`, start (migrate gates app/worker), require `/api/health` to
 * report that sha, and only then remove superseded images and the build cache. Returns the exit code.
 */
export async function runDeploy(deps: ProxyDeps): Promise<number> {
  const { run, engine, log } = deps;

  const status = await run(["git", "status", "--porcelain"], { quiet: true });
  if (status.exitCode !== 0) {
    log("✗ git status failed");
    return 1;
  }
  if (status.stdout.trim() !== "") {
    log("✗ the working tree is dirty; commit or stash before deploying:");
    log(status.stdout.trimEnd());
    return 1;
  }

  const head = await run(["git", "rev-parse", "HEAD"], { quiet: true });
  const sha = head.stdout.trim();
  if (head.exitCode !== 0 || sha === "") {
    log("✗ git rev-parse HEAD failed");
    return 1;
  }
  const env = { GIT_SHA: sha };
  log(`deploying ${sha}`);

  if ((await run(compose(engine, "--profile", "prod", "build"), { env })).exitCode !== 0) {
    log("✗ build failed");
    return 1;
  }
  if (
    (await run(compose(engine, "--profile", "prod", "up", "-d", "--wait"), { env })).exitCode !== 0
  ) {
    log("✗ the stack did not come up healthy (a failed migration keeps app and worker stopped)");
    return 1;
  }

  const health = await checkProxyHealth(deps, () => readContainerCa(deps));
  if (!health.ok) {
    log(`✗ ${health.reason}`);
    return 1;
  }
  if (health.sha !== sha) {
    log(`✗ ${health.origin}/api/health reports sha ${health.sha}, expected ${sha}`);
    return 1;
  }
  log(`✓ ${health.origin}/api/health reports ${sha}`);

  if (!(await removeSupersededImages(deps))) {
    log("✗ cleaning superseded images failed");
    return 1;
  }
  log("✓ deployed");
  return 0;
}
