import { describe, expect, it } from "vite-plus/test";

import { runDeploy } from "./deploy-plan";
import type { Engine } from "./engine";
import type { HealthFetch } from "./health";
import { createRunner, type Env, type Exec } from "./run";

const HEAD = "4f2d9c1e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e";
const CURRENT_IMAGE = `sha256:${"a".repeat(64)}`;
const OLD_IMAGE = `sha256:${"b".repeat(64)}`;
const OLDER_IMAGE = `sha256:${"c".repeat(64)}`;
const podman: Engine = { name: "podman", bin: "podman" };

type Call = { argv: string[]; env: Env };

type Scenario = {
  porcelain?: string;
  upExitCode?: number;
  health?: { status: number; body: unknown } | "unreachable";
  engine?: Engine;
};

/** A host where every command succeeds and answers like a freshly deployed `HEAD`, unless overridden. */
function fakeHost(scenario: Scenario = {}) {
  const calls: Call[] = [];
  const answer = (argv: readonly string[]): { exitCode: number; stdout: string } => {
    const command = argv.join(" ");
    if (command === "git status --porcelain")
      return { exitCode: 0, stdout: scenario.porcelain ?? "" };
    if (command === "git rev-parse HEAD") return { exitCode: 0, stdout: `${HEAD}\n` };
    if (argv.includes("up")) return { exitCode: scenario.upExitCode ?? 0, stdout: "" };
    if (argv.includes("images") && argv.includes("compose")) {
      // `compose images -q`: the image every current service runs (podman prints it once per service).
      return {
        exitCode: 0,
        stdout: `${CURRENT_IMAGE.slice(7, 19)}\n${CURRENT_IMAGE.slice(7, 19)}\n`,
      };
    }
    if (argv[1] === "images")
      return { exitCode: 0, stdout: [CURRENT_IMAGE, OLD_IMAGE, OLDER_IMAGE].join("\n") };
    return { exitCode: 0, stdout: "" };
  };
  const exec: Exec = async (argv, options) => {
    calls.push({ argv: [...argv], env: options.env ?? {} });
    return { ...answer(argv), stderr: "" };
  };
  const health = scenario.health ?? { status: 200, body: { status: "ok", sha: HEAD } };
  const fetch: HealthFetch = async () => {
    if (health === "unreachable") throw new Error("connection refused");
    return { status: health.status, json: async () => health.body };
  };
  const log: string[] = [];
  const deps = {
    run: createRunner(exec, {}),
    engine: scenario.engine ?? podman,
    fetch,
    sleep: async () => {},
    httpPort: "8080",
    log: (line: string) => log.push(line),
  };
  return { deps, calls, log };
}

const isBuild = (call: Call) => call.argv.includes("compose") && call.argv.includes("build");
const isUp = (call: Call) => call.argv.includes("compose") && call.argv.includes("up");
const isRemoval = (call: Call) => call.argv[1] === "rmi" || call.argv.includes("prune");

describe("deploy plan", () => {
  it("refuses a dirty working tree before building", async () => {
    const host = fakeHost({ porcelain: " M src/server/app.ts\n?? notes.txt\n" });

    const exitCode = await runDeploy(host.deps);

    expect(exitCode).not.toBe(0);
    expect(host.calls.map((call) => call.argv.join(" "))).toEqual(["git status --porcelain"]);
  });

  it("fails when the health sha differs", async () => {
    const stale = fakeHost({ health: { status: 200, body: { status: "ok", sha: "0ldc0mm1t" } } });

    expect(await runDeploy(stale.deps)).not.toBe(0);

    const build = stale.calls.find(isBuild);
    expect(build?.env.GIT_SHA).toBe(HEAD);
    expect(stale.calls.find(isUp)?.env.GIT_SHA).toBe(HEAD);
    expect(stale.calls.some(isRemoval)).toBe(false);

    const fresh = fakeHost();
    expect(await runDeploy(fresh.deps)).toBe(0);
    expect(fresh.calls.find(isBuild)?.env.GIT_SHA).toBe(HEAD);
  });

  it("cleans superseded images only after a healthy deploy", async () => {
    const healthy = fakeHost();
    expect(await runDeploy(healthy.deps)).toBe(0);

    const removals = healthy.calls.filter(isRemoval).map((call) => call.argv);
    expect(removals).toEqual([
      ["podman", "rmi", OLD_IMAGE, OLDER_IMAGE],
      [
        "podman",
        "builder",
        "prune",
        "-f",
        "--filter",
        "label=com.parcela.project=parcela-mais-case",
      ],
    ]);
    const labelledListing = healthy.calls.find((call) => call.argv[1] === "images");
    expect(labelledListing?.argv).toContain("label=com.parcela.project=parcela-mais-case");
    const upIndex = healthy.calls.findIndex(isUp);
    expect(healthy.calls.findIndex(isRemoval)).toBeGreaterThan(upIndex);

    const docker = fakeHost({ engine: { name: "docker", bin: "docker" } });
    expect(await runDeploy(docker.deps)).toBe(0);
    expect(docker.calls.filter(isRemoval).map((call) => call.argv)).toEqual([
      ["docker", "rmi", OLD_IMAGE, OLDER_IMAGE],
      ["docker", "builder", "prune", "-f"],
    ]);

    const unhealthy: Scenario[] = [
      { upExitCode: 1 },
      { health: "unreachable" },
      { health: { status: 503, body: {} } },
      { health: { status: 200, body: { status: "ok", sha: "0ldc0mm1t" } } },
    ];
    for (const scenario of unhealthy) {
      const host = fakeHost(scenario);
      expect(await runDeploy(host.deps)).not.toBe(0);
      expect(host.calls.some(isRemoval)).toBe(false);
    }
  });
});
