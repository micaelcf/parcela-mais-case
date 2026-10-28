import { describe, expect, it } from "vite-plus/test";

import type { Engine } from "./engine";
import { prunePlan, runPrune } from "./prune-plan";
import { createRunner, type Exec } from "./run";

const LABEL_FILTER = "label=com.parcela.project=parcela-mais-case";

function recordingDeps(engine: Engine) {
  const executed: string[][] = [];
  const exec: Exec = async (argv) => {
    executed.push([...argv]);
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return { deps: { run: createRunner(exec, {}), engine, log: () => {} }, executed };
}

const scopedToProject = (argv: readonly string[]) => {
  const composeProject =
    argv[1] === "compose" && argv.slice(2, 6).join(" ") === "-f compose.yaml -p parcela-mais-case";
  const labelled = argv.some((arg, i) => arg === "--filter" && argv[i + 1] === LABEL_FILTER);
  return composeProject || labelled;
};

describe("prune plan (RF-705)", () => {
  it("targets only this project locally", async () => {
    const podman = recordingDeps({ name: "podman", bin: "podman" });
    expect(await runPrune(podman.deps, [])).toBe(0);
    expect(podman.executed).toEqual(prunePlan({ name: "podman", bin: "podman" }));
    expect(podman.executed[0]).toEqual([
      "podman",
      "compose",
      "-f",
      "compose.yaml",
      "-p",
      "parcela-mais-case",
      "--profile",
      "prod",
      "down",
      "-v",
      "--remove-orphans",
      "--rmi",
      "local",
    ]);
    for (const argv of podman.executed) expect(scopedToProject(argv), argv.join(" ")).toBe(true);

    // Docker's BuildKit cache can't be labelled: the one unscoped step only drops unreferenced cache.
    const docker = recordingDeps({ name: "docker", bin: "docker" });
    expect(await runPrune(docker.deps, [])).toBe(0);
    const unscoped = docker.executed.filter((argv) => !scopedToProject(argv));
    expect(unscoped).toEqual([["docker", "builder", "prune", "-f"]]);

    for (const argv of [...podman.executed, ...docker.executed]) {
      expect(
        argv.filter((arg) => /^(-H|--host|--url|--connection|--context|-a|--all)(=|$)/.test(arg)),
      ).toEqual([]);
    }

    for (const args of [
      ["--host", "ssh://box"],
      ["-H", "tcp://box:2375"],
      ["--remote"],
      ["--context=prod"],
      ["box"],
    ]) {
      const attempt = recordingDeps({ name: "podman", bin: "podman" });
      expect(await runPrune(attempt.deps, args), args.join(" ")).not.toBe(0);
      expect(attempt.executed).toEqual([]);
    }
  });
});
