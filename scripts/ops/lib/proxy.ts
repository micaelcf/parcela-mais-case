import { compose, type Engine } from "./engine";
import {
  checkHealth,
  type HealthFetch,
  type HealthResult,
  healthRequest,
  type ProxySite,
  proxySite,
  type Sleep,
  siteOrigin,
} from "./health";
import { CONTAINER_CA_ROOT, type LocalCa, waitForCa } from "./local-ca";
import type { Env, RunCommand } from "./run";

/** What `up --prod` and `deploy` need to reach the prod stack's Caddy. */
export type ProxyDeps = {
  readonly run: RunCommand;
  readonly engine: Engine;
  readonly fetch: HealthFetch;
  readonly sleep: Sleep;
  /** Read for APP_DOMAIN, HTTPS_PORT (compose reads the same keys from .env). */
  readonly env: Env;
  readonly log: (line: string) => void;
};

/**
 * The prod `caddy` container's local CA root, once Caddy has written it: `deploy`'s source, where
 * /data is the `caddy_data` volume (a `*.localhost` or IP APP_DOMAIN on that host).
 */
export function readContainerCa(deps: ProxyDeps): Promise<LocalCa | null> {
  const cat = compose(deps.engine, "exec", "-T", "caddy", "cat", CONTAINER_CA_ROOT);
  return waitForCa(async () => {
    const result = await deps.run(cat, { quiet: true });
    return result.exitCode === 0 ? result.stdout : null;
  }, deps.sleep);
}

export type ProxyHealth =
  | {
      readonly ok: true;
      readonly site: ProxySite;
      readonly origin: string;
      readonly ca: LocalCa | null;
      readonly sha: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * `/api/health` through the prod stack's Caddy, over TLS verified against the CA that issued the
 * site's certificate: Caddy's local CA for `*.localhost` (from `readCa`), the system's for a
 * public domain; plain HTTP for a bare `:<port>`.
 */
export async function checkProxyHealth(
  deps: ProxyDeps,
  readCa: () => Promise<LocalCa | null>,
): Promise<ProxyHealth> {
  const site = proxySite(deps.env);
  const origin = siteOrigin(site);
  let ca: LocalCa | null = null;
  if (site.scheme === "https" && site.issuer === "local") {
    ca = await readCa();
    if (ca === null) return { ok: false, reason: "caddy wrote no local CA root" };
  }
  const { url, init } = healthRequest(site, ca?.pem);
  // A public domain may still be getting its first ACME certificate.
  const health: HealthResult = await checkHealth({
    url,
    init,
    fetch: deps.fetch,
    sleep: deps.sleep,
    attempts: 30,
  });
  return health.ok
    ? { ok: true, site, origin, ca, sha: health.sha }
    : { ok: false, reason: `${origin}/api/health is not healthy: ${health.reason}` };
}
