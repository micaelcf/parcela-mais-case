import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";

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

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function isIpv4(value: unknown): value is string {
  return typeof value === "string" && IPV4.test(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The IPv4 gateway in `docker network inspect bridge --format '{{json .IPAM.Config}}'`: a
 * dual-stack default bridge lists an IPv6 entry too.
 */
export function ipv4BridgeGateway(ipamConfigJson: string): string | null {
  const configs = parseJson(ipamConfigJson);
  if (!Array.isArray(configs)) return null;
  for (const config of configs) {
    if (typeof config === "object" && config !== null && "Gateway" in config) {
      if (isIpv4(config.Gateway)) return config.Gateway;
    }
  }
  return null;
}

/**
 * daemon.json's `host-gateway-ips` (Docker 28+) or `host-gateway-ip`: where `host-gateway` points
 * instead of the default bridge's gateway. Its IPv4 address, or null when it isn't set.
 */
export function hostGatewayOverride(daemonJson: string): string | null {
  const config = parseJson(daemonJson);
  if (typeof config !== "object" || config === null) return null;
  if ("host-gateway-ips" in config && Array.isArray(config["host-gateway-ips"])) {
    return config["host-gateway-ips"].find(isIpv4) ?? null;
  }
  if ("host-gateway-ip" in config && isIpv4(config["host-gateway-ip"])) {
    return config["host-gateway-ip"];
  }
  return null;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * The address `host-gateway` resolves to on Linux Docker: a daemon.json override (rootful, then
 * rootless), else the default bridge's IPv4 gateway; null when Docker doesn't answer. A
 * `--host-gateway-ip` dockerd flag isn't visible here.
 */
function dockerHostGateway(engine: Engine): string | null {
  for (const file of ["/etc/docker/daemon.json", join(homedir(), ".config/docker/daemon.json")]) {
    const text = readText(file);
    const override = text === null ? null : hostGatewayOverride(text);
    if (override) return override;
  }
  try {
    const format = "{{json .IPAM.Config}}";
    const output = execFileSync(engine.bin, ["network", "inspect", "bridge", "--format", format], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
    return ipv4BridgeGateway(output);
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
    dockerHostGateway: linux && engine.name === "docker" ? dockerHostGateway(engine) : null,
  };
}
