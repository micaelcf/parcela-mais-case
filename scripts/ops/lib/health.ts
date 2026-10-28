import { isIP } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import Type from "typebox";
import { Compile } from "typebox/compile";

import { assertLocalUrl, type Env } from "./run";

/** `GET /api/health` body (`system.routes.ts`). */
const HealthBody = Compile(Type.Object({ status: Type.Literal("ok"), sha: Type.String() }));

export type HealthRequestInit = {
  readonly headers?: Readonly<Record<string, string>>;
  /** Bun `fetch` TLS: the SNI name, and the CA the chain must end in (system CAs when absent). */
  readonly tls?: { readonly serverName: string; readonly ca?: string };
};
export type HealthResponse = { readonly status: number; json(): Promise<unknown> };
export type HealthFetch = (url: string, init?: HealthRequestInit) => Promise<HealthResponse>;
export type Sleep = (ms: number) => Promise<void>;

export const sleep: Sleep = (ms) => delay(ms);

export type HealthResult = { ok: true; sha: string } | { ok: false; reason: string };

/** compose.yaml's `${APP_DOMAIN:-parcela.localhost}` and caddy-dev's site. */
export const DEFAULT_APP_DOMAIN = "parcela.localhost";

/**
 * Where Caddy serves `APP_DOMAIN`, seen from this host. `local`: Caddy's own CA issued the
 * certificate (`*.localhost` and IP addresses); `acme`: a public CA the system already trusts.
 * A bare `:<port>` is the plain-HTTP fallback.
 */
export type ProxySite =
  | {
      readonly scheme: "https";
      readonly host: string;
      readonly port: string;
      readonly issuer: "local" | "acme";
    }
  | { readonly scheme: "http"; readonly port: string };

export function proxySite(env: Env): ProxySite {
  const domain = env.APP_DOMAIN || DEFAULT_APP_DOMAIN;
  if (domain.startsWith(":")) return { scheme: "http", port: domain.slice(1) };
  const local = domain === "localhost" || domain.endsWith(".localhost") || isIP(domain) !== 0;
  return {
    scheme: "https",
    host: domain,
    port: env.HTTPS_PORT || "8443",
    issuer: local ? "local" : "acme",
  };
}

/** The address a browser opens: `https://parcela.localhost:8443`, `https://example.com`. */
export function siteOrigin(site: ProxySite): string {
  if (site.scheme === "http") return `http://localhost:${site.port}`;
  return site.port === "443" ? `https://${site.host}` : `https://${site.host}:${site.port}`;
}

/**
 * `/api/health` through Caddy without the OS resolver: the request goes to loopback and names the
 * site through SNI and `Host`, so it works where `*.localhost` doesn't resolve outside browsers.
 */
export function healthRequest(
  site: ProxySite,
  ca?: string,
): { url: string; init?: HealthRequestInit } {
  if (site.scheme === "http") return { url: `http://localhost:${site.port}/api/health` };
  return {
    url: `https://localhost:${site.port}/api/health`,
    init: {
      headers: { host: new URL(siteOrigin(site)).host },
      tls: ca === undefined ? { serverName: site.host } : { serverName: site.host, ca },
    },
  };
}

/**
 * Polls `url` until it answers 200 with a valid health body, up to `attempts` times. Only network
 * errors and non-200 answers are retried: a valid answer is final.
 */
export async function checkHealth(input: {
  url: string;
  init?: HealthRequestInit;
  fetch: HealthFetch;
  sleep: Sleep;
  attempts?: number;
  delayMs?: number;
}): Promise<HealthResult> {
  assertLocalUrl(input.url);
  const attempts = input.attempts ?? 15;
  let reason = "no attempt made";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await input.fetch(input.url, input.init);
      if (response.status === 200) {
        const body = await response.json();
        if (HealthBody.Check(body)) return { ok: true, sha: body.sha };
        return { ok: false, reason: `unexpected health body ${JSON.stringify(body)}` };
      }
      reason = `HTTP ${response.status}`;
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) await input.sleep(input.delayMs ?? 1_000);
  }
  return { ok: false, reason };
}
