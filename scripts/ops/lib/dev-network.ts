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

/** Read-only facts `devBinding` needs about this machine. */
export function gatherDevNetworkFacts(engine: Engine): DevNetworkFacts {
  return {
    platform: process.platform,
    engine,
    interfaces: networkInterfaces(),
    defaultRouteInterface: process.platform === "linux" ? defaultRouteInterface() : null,
  };
}
