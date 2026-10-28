import type { Env } from "./run";

/** Compose project name; every container, volume and network of this repo lives under it. */
export const PROJECT = "parcela-mais-case";
/** Label on every image this repo builds (`compose.yaml` + `Dockerfile`). */
export const PROJECT_LABEL = `com.parcela.project=${PROJECT}`;
/** Label compose puts on every container of the project. */
export const COMPOSE_PROJECT_LABEL = `com.docker.compose.project=${PROJECT}`;

export type EngineName = "podman" | "docker";
export type Engine = { readonly name: EngineName; readonly bin: string };

export type EngineProbe = {
  readonly env: Env;
  /** Absolute path of an executable on PATH, or null. */
  which(command: string): string | null;
  exists(path: string): boolean;
};

const ENGINE_NAMES: Record<string, EngineName> = { podman: "podman", docker: "docker" };

function podmanWindowsInstall(probe: EngineProbe): string | null {
  const localAppData = probe.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const path = `${localAppData}\\Programs\\Podman\\podman.exe`;
  return probe.exists(path) ? path : null;
}

function locate(name: EngineName, probe: EngineProbe): string | null {
  const onPath = probe.which(name);
  if (onPath) return onPath;
  return name === "podman" ? podmanWindowsInstall(probe) : null;
}

/**
 * `CONTAINER_ENGINE` (`podman` | `docker`) wins; otherwise Podman when found on PATH or at its
 * Windows install path, else Docker. An engine that isn't installed resolves to its bare name, so
 * the first command fails with the engine's own "not found" error (and `doctor` reports it).
 */
export function detectEngine(probe: EngineProbe): Engine {
  const override = probe.env.CONTAINER_ENGINE;
  if (override) {
    const key = override.toLowerCase();
    const name = Object.hasOwn(ENGINE_NAMES, key) ? ENGINE_NAMES[key] : undefined;
    if (!name) throw new Error(`CONTAINER_ENGINE must be "podman" or "docker", got "${override}"`);
    return { name, bin: locate(name, probe) ?? name };
  }
  const podman = locate("podman", probe);
  if (podman) return { name: "podman", bin: podman };
  return { name: "docker", bin: locate("docker", probe) ?? "docker" };
}

/** `<engine> compose -f compose.yaml -p parcela-mais-case …args`: the prod stack; publishes only Caddy. */
export function compose(engine: Engine, ...args: readonly string[]): string[] {
  return [engine.bin, "compose", "-f", "compose.yaml", "-p", PROJECT, ...args];
}

/** `compose` plus `compose.dev.yaml` (Postgres on the host port, dev password): `vp run up` only. */
export function devCompose(engine: Engine, ...args: readonly string[]): string[] {
  const files = ["-f", "compose.yaml", "-f", "compose.dev.yaml"];
  return [engine.bin, "compose", ...files, "-p", PROJECT, ...args];
}

/** Removes dangling images carrying the project label (superseded builds, intermediate layers). */
export function pruneDanglingProjectImages(engine: Engine): string[] {
  return [engine.bin, "image", "prune", "-f", "--filter", `label=${PROJECT_LABEL}`];
}

export type BuildCachePrune = { readonly argv: string[] } | { readonly skipped: string };

/**
 * Build cache removal, this project's only. Podman's build cache is its intermediate images, which
 * carry the project label. Docker's BuildKit cache has no labels and `builder prune` can't filter by
 * project, so on Docker it is skipped rather than pruning every project's cache.
 */
const BUILD_CACHE_PRUNE: Record<EngineName, readonly string[] | null> = {
  podman: ["builder", "prune", "-f", "--filter", `label=${PROJECT_LABEL}`],
  docker: null,
};

export function pruneBuildCache(engine: Engine): BuildCachePrune {
  const args = BUILD_CACHE_PRUNE[engine.name];
  return args
    ? { argv: [engine.bin, ...args] }
    : {
        skipped: `build cache skipped: ${engine.name}'s build cache has no project label (\`${engine.name} builder prune\` would clear every project's)`,
      };
}
