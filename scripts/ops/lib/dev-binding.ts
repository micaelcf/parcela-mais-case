import type { Engine } from "./engine";
import type { Env } from "./run";

/**
 * Where `vp dev` listens in the dev stack: the one host address caddy-dev's container reaches, and
 * nothing else, so the dev app (and its documented backoffice password) stays off the LAN and any
 * tailnet. Pure: `dev-network.ts` gathers the facts.
 */

export type NetworkInterfaces = Readonly<
  Record<
    string,
    ReadonlyArray<{ readonly family: string | number; readonly address: string }> | undefined
  >
>;

export type DevNetworkFacts = {
  readonly platform: NodeJS.Platform;
  readonly engine: Engine;
  readonly interfaces: NetworkInterfaces;
  /** Linux: the interface of the IPv4 default route (`/proc/net/route`), or null. */
  readonly defaultRouteInterface: string | null;
};

export type DevBinding =
  | {
      readonly ok: true;
      /** `vp dev --host <listen>`. */
      readonly listen: string;
      /** caddy-dev's upstream host when `host.containers.internal` isn't `listen`'s host (DEV_UPSTREAM_HOST). */
      readonly upstream?: string;
      /** What else can reach `listen` (doctor, docs). */
      readonly note: string;
      /** `listen` is on a network other machines share: only a firewall keeps port 3000 off it. */
      readonly lanReachable: boolean;
    }
  | { readonly ok: false; readonly reason: string };

function ipv4(interfaces: NetworkInterfaces, matches: (name: string) => boolean): string | null {
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!matches(name)) continue;
    const found = addresses?.find(({ family }) => family === "IPv4" || family === 4);
    if (found) return found.address;
  }
  return null;
}

const LOOPBACK: DevBinding = {
  ok: true,
  listen: "127.0.0.1",
  note: "loopback only: the engine forwards host.containers.internal to the host's 127.0.0.1",
  lanReachable: false,
};

/**
 * Per OS (and engine), the narrowest address caddy-dev reaches:
 * - Windows + Podman: the VM (WSL, NAT) sees Windows only as its gateway, the `vEthernet (WSL…)`
 *   adapter, a host-only virtual switch; `host.containers.internal` is the VM itself, so caddy-dev
 *   dials that address too. Windows + Docker Desktop forwards to the host's loopback.
 * - macOS: Podman's gvproxy and Docker Desktop forward to the host's loopback.
 * - Linux + Docker: `host-gateway` is the `docker0` bridge address, host-only.
 * - Linux + rootless Podman: pasta maps `host.containers.internal` to the host's own address on
 *   its default-route interface (never to loopback, by design), which is on the LAN; a host
 *   firewall must keep port 3000 closed to it.
 */
const DEV_BINDINGS: Partial<Record<NodeJS.Platform, (facts: DevNetworkFacts) => DevBinding>> = {
  win32: (facts) => {
    if (facts.engine.name !== "podman") return LOOPBACK;
    const address = ipv4(facts.interfaces, (name) => name.startsWith("vEthernet (WSL"));
    return address
      ? {
          ok: true,
          listen: address,
          upstream: address,
          note: "the vEthernet (WSL) adapter: a host-only switch between Windows and the Podman VM",
          lanReachable: false,
        }
      : {
          ok: false,
          reason:
            "no vEthernet (WSL…) adapter with an IPv4 address: start the Podman machine (podman machine start)",
        };
  },
  darwin: () => LOOPBACK,
  linux: (facts) => {
    if (facts.engine.name === "docker") {
      const address = ipv4(facts.interfaces, (name) => name === "docker0");
      return address
        ? {
            ok: true,
            listen: address,
            note: "the docker0 bridge (host-gateway): host-only",
            lanReachable: false,
          }
        : { ok: false, reason: "no docker0 bridge address: is the Docker daemon running?" };
    }
    const route = facts.defaultRouteInterface;
    const address = route ? ipv4(facts.interfaces, (name) => name === route) : null;
    return address
      ? {
          ok: true,
          listen: address,
          note: `${route}'s address, where rootless Podman's pasta maps host.containers.internal`,
          lanReachable: true,
        }
      : {
          ok: false,
          reason:
            "no IPv4 default route: rootless Podman maps host.containers.internal to its interface",
        };
  },
};

export function devBinding(facts: DevNetworkFacts): DevBinding {
  return DEV_BINDINGS[facts.platform]?.(facts) ?? LOOPBACK;
}

/** The documented dev value (`.env.example`, server-env default): the dev server's own origin. */
const DEFAULT_DEV_ORIGIN = "http://localhost:3000";

/**
 * Env for the app and worker processes: `localhost:3000` doesn't reach a dev server bound to one
 * address, so the lender simulator URL follows it, unless `.env.local` points elsewhere. The
 * process env wins over the `.env*` files Bun loads.
 */
export function devProcessEnv(env: Env, listen: string): Env {
  const configured = env.LENDER_BASE_URL;
  const custom =
    configured !== undefined &&
    (!URL.canParse(configured) || new URL(configured).origin !== DEFAULT_DEV_ORIGIN);
  if (custom) return {};
  return { LENDER_BASE_URL: `http://${listen}:3000/api/simulator/lenders` };
}
