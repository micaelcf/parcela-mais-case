import { describe, expect, it } from "vite-plus/test";

import { downPlan, runDown } from "./down-plan";
import type { Engine } from "./engine";
import { createRunner, type Exec } from "./run";

const podman: Engine = { name: "podman", bin: "podman" };

function recordingDeps(engine: Engine, exitCode = 0) {
  const executed: string[][] = [];
  const log: string[] = [];
  const exec: Exec = async (argv) => {
    executed.push([...argv]);
    return { exitCode, stdout: "", stderr: "" };
  };
  const deps = { run: createRunner(exec, {}), engine, log: (line: string) => log.push(line) };
  return { deps, executed, log };
}

/** Anything that would delete data, images or another project's resources. */
const DESTRUCTIVE =
  /^(-v|--volumes|--rmi|prune|rm|-a|--all|-H|--host|--url|--connection|--context)(=|$)/;

describe("down plan", () => {
  it("removes this project's containers (caddy-dev included) and network, keeping its data and images", async () => {
    const { deps, executed, log } = recordingDeps(podman);
    expect(await runDown(deps, [])).toBe(0);
    expect(executed).toEqual([
      [
        "podman",
        "compose",
        "-f",
        "compose.yaml",
        "-f",
        "compose.dev.yaml",
        "-p",
        "parcela-mais-case",
        "--profile",
        "prod",
        "down",
        "--remove-orphans",
      ],
    ]);
    expect(log.join("\n")).toMatch(/data volume kept/);
  });

  it("only stops the containers (caddy-dev included) with --stop", async () => {
    const { deps, executed } = recordingDeps(podman);
    expect(await runDown(deps, ["--stop"])).toBe(0);
    expect(executed).toEqual([
      [
        "podman",
        "compose",
        "-f",
        "compose.yaml",
        "-f",
        "compose.dev.yaml",
        "-p",
        "parcela-mais-case",
        "--profile",
        "prod",
        "stop",
      ],
    ]);
  });

  it("never deletes volumes or images and never leaves this project", () => {
    for (const engine of [podman, { name: "docker", bin: "docker" } satisfies Engine]) {
      for (const mode of ["down", "stop"] as const) {
        for (const argv of downPlan(engine, mode)) {
          expect(argv.slice(1, 8)).toEqual([
            "compose",
            "-f",
            "compose.yaml",
            "-f",
            "compose.dev.yaml",
            "-p",
            "parcela-mais-case",
          ]);
          expect(
            argv.filter((arg) => DESTRUCTIVE.test(arg)),
            argv.join(" "),
          ).toEqual([]);
        }
      }
    }
  });

  it("refuses unknown options before running anything", async () => {
    for (const args of [
      ["-v"],
      ["--volumes"],
      ["--rmi", "local"],
      ["--host", "ssh://box"],
      ["box"],
      ["--stop", "-v"],
    ]) {
      const attempt = recordingDeps(podman);
      expect(await runDown(attempt.deps, args), args.join(" ")).toBe(2);
      expect(attempt.executed).toEqual([]);
    }
  });

  it("fails when compose fails", async () => {
    const { deps, log } = recordingDeps(podman, 1);
    expect(await runDown(deps, [])).toBe(1);
    expect(log.join("\n")).toMatch(/✗/);
  });
});
