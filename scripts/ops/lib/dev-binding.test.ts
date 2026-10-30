import { describe, expect, it } from "vite-plus/test";

import { devBinding, type DevNetworkFacts, devProcessEnv } from "./dev-binding";
import type { Engine } from "./engine";
import { devProcesses } from "./up-plan";

const podman: Engine = { name: "podman", bin: "podman" };
const docker: Engine = { name: "docker", bin: "docker" };

/** A laptop on Wi-Fi and a tailnet, with the WSL switch and a Docker bridge. */
const interfaces = {
  "Wi-Fi": [{ family: "IPv4", address: "192.168.1.67" }],
  wlp2s0: [{ family: "IPv4", address: "192.168.1.67" }],
  Tailscale: [{ family: "IPv4", address: "100.85.80.43" }],
  "vEthernet (WSL (Hyper-V firewall))": [
    { family: "IPv6", address: "fe80::1" },
    { family: "IPv4", address: "192.168.160.1" },
  ],
  docker0: [{ family: 4, address: "172.17.0.1" }],
};

const facts = (overrides: Partial<DevNetworkFacts>): DevNetworkFacts => ({
  platform: "win32",
  engine: podman,
  interfaces,
  defaultRouteInterface: null,
  dockerHostGateway: null,
  ...overrides,
});

/** Addresses other machines on the LAN or the tailnet reach. */
const SHARED = ["192.168.1.67", "100.85.80.43"];

describe("dev server binding per OS", () => {
  it("Windows + Podman: the WSL switch address, which caddy-dev dials too", () => {
    expect(devBinding(facts({}))).toMatchObject({
      ok: true,
      listen: "192.168.160.1",
      upstream: "192.168.160.1",
      lanReachable: false,
    });
    expect(devBinding(facts({ interfaces: { "Wi-Fi": interfaces["Wi-Fi"] } }))).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/podman machine start/),
    });
  });

  it("loopback where the engine forwards host.containers.internal there (macOS, Docker Desktop)", () => {
    for (const binding of [
      devBinding(facts({ platform: "darwin" })),
      devBinding(facts({ platform: "darwin", engine: docker })),
      devBinding(facts({ engine: docker })),
    ]) {
      expect(binding).toMatchObject({ ok: true, listen: "127.0.0.1", lanReachable: false });
      expect(binding).not.toHaveProperty("upstream");
    }
  });

  it("Linux + Docker: the docker0 bridge; Linux + rootless Podman: pasta's host address, flagged", () => {
    expect(devBinding(facts({ platform: "linux", engine: docker }))).toMatchObject({
      ok: true,
      listen: "172.17.0.1",
      lanReachable: false,
    });
    expect(devBinding(facts({ platform: "linux", defaultRouteInterface: "wlp2s0" }))).toMatchObject(
      {
        ok: true,
        listen: "192.168.1.67",
        lanReachable: true,
      },
    );
    expect(devBinding(facts({ platform: "linux" }))).toMatchObject({ ok: false });
  });

  it("Linux + Docker with docker0 down: the address Docker resolves host-gateway to", () => {
    // No container on the default bridge leaves docker0 without carrier, and the OS interface list
    // skips interfaces that aren't running; host-gateway still resolves to its gateway address.
    const { docker0: _down, ...withoutDocker0 } = interfaces;
    const linuxDocker = { platform: "linux", engine: docker, interfaces: withoutDocker0 } as const;
    expect(devBinding(facts({ ...linuxDocker, dockerHostGateway: "172.17.0.1" }))).toMatchObject({
      ok: true,
      listen: "172.17.0.1",
      lanReachable: false,
    });
    expect(devBinding(facts(linuxDocker))).toMatchObject({ ok: false });
  });

  it("never listens on every interface, and only Linux + Podman lands on a shared network", () => {
    const platforms = ["win32", "darwin", "linux"] as const;
    for (const platform of platforms) {
      for (const engine of [podman, docker]) {
        const binding = devBinding(facts({ platform, engine, defaultRouteInterface: "wlp2s0" }));
        if (!binding.ok) throw new Error(binding.reason);
        const label = `${platform} ${engine.name}`;
        expect(["0.0.0.0", "::"], label).not.toContain(binding.listen);
        expect(binding.lanReachable, label).toBe(platform === "linux" && engine.name === "podman");
        expect(SHARED.includes(binding.listen), label).toBe(binding.lanReachable);
        expect(devProcesses(binding.listen)[0]?.argv, label).toEqual([
          "vp",
          "dev",
          "--port",
          "3000",
          "--host",
          binding.listen,
        ]);
      }
    }
  });
});

describe("dev process env", () => {
  it("points the lender simulator at the dev server's address, unless configured elsewhere", () => {
    const expected = { LENDER_BASE_URL: "http://192.168.160.1:3000/api/simulator/lenders" };
    expect(devProcessEnv({}, "192.168.160.1")).toEqual(expected);
    expect(
      devProcessEnv(
        { LENDER_BASE_URL: "http://localhost:3000/api/simulator/lenders" },
        "192.168.160.1",
      ),
    ).toEqual(expected);
    expect(
      devProcessEnv({ LENDER_BASE_URL: "https://lenders.example.com/api" }, "192.168.160.1"),
    ).toEqual({});
  });
});
