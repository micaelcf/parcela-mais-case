import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";

import type { DevNetworkFacts } from "./dev-binding";
import type { Engine } from "./engine";

/** Linux `/proc/net/route`: the interface whose destination is 0.0.0.0 (the default route). */
function defaultRouteInterface(): string | null {
  try {
    for (const line of readFileSync("/proc/net/route", "utf8").split("\n").slice(1)) {
      const [iface, destination] = line.trim().split(/\s+/);
      if (iface && destination === "00000000") return iface;
    }
  } catch {
    // No procfs: no default route known.
  }
  return null;
}

/** The Docker default bridge's gateway (`host-gateway`), or null when Docker doesn't answer. */
function dockerBridgeGateway(engine: Engine): string | null {
  try {
    const format = "{{range .IPAM.Config}}{{.Gateway}}{{end}}";
    const output = execFileSync(engine.bin, ["network", "inspect", "bridge", "--format", format], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
    return /^\d+\.\d+\.\d+\.\d+$/.test(output.trim()) ? output.trim() : null;
  } catch {
    return null;
  }
}

/** Read-only facts `devBinding` needs about this machine. */
export function gatherDevNetworkFacts(engine: Engine): DevNetworkFacts {
  const linux = process.platform === "linux";
  return {
    platform: process.platform,
    engine,
    interfaces: networkInterfaces(),
    defaultRouteInterface: linux ? defaultRouteInterface() : null,
    dockerBridgeGateway: linux && engine.name === "docker" ? dockerBridgeGateway(engine) : null,
  };
}
