import { describe, expect, it } from "vite-plus/test";

import { createRunner, type Exec, RemoteCommandError } from "./run";

function recordingRunner(baseEnv: Record<string, string | undefined> = {}) {
  const executed: string[][] = [];
  const exec: Exec = async (argv) => {
    executed.push([...argv]);
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return { run: createRunner(exec, baseEnv), executed };
}

const PODMAN_WINDOWS = "C:\\Users\\me\\AppData\\Local\\Programs\\Podman\\podman.exe";

describe("ops command runner (RF-710)", () => {
  it("refuses remote-capable commands", async () => {
    const refused: string[][] = [
      ["ssh", "deploy@example.com"],
      ["scp", "file", "host:/tmp"],
      ["sftp", "host"],
      ["rsync", "-a", ".", "host:/srv"],
      ["/usr/bin/ssh", "host"],
      ["ssh.exe", "host"],
      ...["fetch", "pull", "push", "clone", "remote", "ls-remote"].map((verb) => ["git", verb]),
      ["podman", "-H", "tcp://10.0.0.1:2375", "ps"],
      ["docker", "--host", "ssh://user@host", "compose", "up"],
      ["docker", "--host=tcp://host:2376", "ps"],
      ["podman", "--url", "ssh://core@host/run/podman.sock", "ps"],
      ["podman", "--url=unix:///remote.sock", "images"],
      ["podman", "--connection", "prod-box", "ps"],
      ["podman", "--connection=prod-box", "ps"],
      ["podman", "-c", "prod-box", "ps"],
      [PODMAN_WINDOWS, "--connection", "prod-box", "compose", "up"],
      ["curl", "https://example.com"],
    ];
    const { run, executed } = recordingRunner();
    for (const argv of refused) {
      await expect(run(argv), argv.join(" ")).rejects.toBeInstanceOf(RemoteCommandError);
    }

    for (const name of ["DOCKER_HOST", "CONTAINER_HOST"]) {
      const fromBase = recordingRunner({ [name]: "ssh://user@host" });
      await expect(fromBase.run(["podman", "ps"])).rejects.toBeInstanceOf(RemoteCommandError);
      const perCommand = recordingRunner();
      await expect(
        perCommand.run(["docker", "compose", "up"], { env: { [name]: "tcp://host:2375" } }),
      ).rejects.toBeInstanceOf(RemoteCommandError);
      expect([...fromBase.executed, ...perCommand.executed]).toEqual([]);
    }
    expect(executed).toEqual([]);

    const allowed: string[][] = [
      ["podman", "compose", "-f", "compose.yaml", "-p", "parcela-mais-case", "up", "-d"],
      [PODMAN_WINDOWS, "images", "-q"],
      ["docker", "compose", "-f", "compose.yaml", "-p", "parcela-mais-case", "build"],
      ["git", "status", "--porcelain"],
      ["git", "rev-parse", "HEAD"],
      ["bun", "scripts/ops/migrate.ts"],
      ["vp", "dev", "--port", "3000"],
    ];
    for (const argv of allowed) await run(argv);
    expect(executed).toEqual(allowed);
  });
});
