import { readFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";

import { parse as parseDotenv } from "dotenv";
import { describe, expect, it } from "vite-plus/test";

import { verifyPassword } from "#/server/modules/backoffice/auth/password";

import type { Engine } from "./engine";
import {
  type HealthFetch,
  type HealthRequestInit,
  healthRequest,
  proxySite,
  siteOrigin,
} from "./health";
import { DEV_CA_ROOT, DEV_CADDY_DATA, describeCa, type LocalCa } from "./local-ca";
import { createRunner, type Env, type Exec } from "./run";
import { TEST_ROOT_PEM } from "./test-ca.fixture";
import {
  backofficeLines,
  checkDevHealth,
  DEV_BACKOFFICE_PASSWORD,
  devProcesses,
  devSetupPlan,
  processPrefix,
  runDevSetup,
  runProdUp,
} from "./up-plan";

const podman: Engine = { name: "podman", bin: "podman" };
const ca: LocalCa = describeCa(TEST_ROOT_PEM);
const example = parseDotenv(readFileSync(".env.example"));
const HEALTHY = { status: 200, json: async () => ({ status: "ok", sha: "dev" }) };

describe("dev stack (vp run up)", () => {
  it("starts Postgres and caddy-dev, telling compose where the host's dev server is", async () => {
    const calls: Array<{ argv: string[]; env: Env }> = [];
    const exec: Exec = async (argv, options) => {
      calls.push({ argv: [...argv], env: options.env ?? {} });
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const composeEnv = { DEV_UPSTREAM_HOST: "192.168.160.1" };
    expect(
      await runDevSetup({ run: createRunner(exec, {}), engine: podman, composeEnv, log: () => {} }),
    ).toBe(0);
    expect(calls.map(({ argv }) => argv)).toEqual(devSetupPlan(podman));
    expect(calls[0]?.argv.slice(-5)).toEqual(["up", "-d", "--wait", "postgres", "caddy-dev"]);
    expect(calls[0]?.env.DEV_UPSTREAM_HOST).toBe("192.168.160.1");
  });

  it("checks health on loopback, naming parcela.localhost through SNI and Host, against caddy-dev's CA", async () => {
    const requests: Array<{ url: string; init?: HealthRequestInit }> = [];
    const fetch: HealthFetch = async (url, init) => {
      requests.push({ url, init });
      return HEALTHY;
    };
    const health = await checkDevHealth({ fetch, sleep: async () => {}, env: {}, ca });
    expect(health).toEqual({ ok: true, sha: "dev" });
    expect(requests).toEqual([
      {
        url: "https://localhost:8443/api/health",
        init: {
          headers: { host: "parcela.localhost:8443" },
          tls: { serverName: "parcela.localhost", ca: TEST_ROOT_PEM },
        },
      },
    ]);
  });
});

describe("dev process prefixes", () => {
  it("give each process its own colour and keep every line starting in one column", () => {
    const [app, worker] = devProcesses("192.168.0.1");

    const colored = [processPrefix(app, true), processPrefix(worker, true)];
    expect(colored.map((prefix) => stripVTControlCharacters(prefix))).toEqual([
      "[app]    ",
      "[worker] ",
    ]);
    // The escape sequence before each label: present, and different per process.
    const colorOf = (prefix: string, name: string) => prefix.slice(0, prefix.indexOf(`[${name}]`));
    expect(colorOf(colored[0], "app")).not.toBe("");
    expect(colorOf(colored[0], "app")).not.toBe(colorOf(colored[1], "worker"));
    // Not a terminal: plain text, same columns.
    expect([processPrefix(app, false), processPrefix(worker, false)]).toEqual([
      "[app]    ",
      "[worker] ",
    ]);
  });
});

describe("backoffice login lines", () => {
  const origin = "https://parcela.localhost:8443";

  it(".env.example's hash is the documented dev password", async () => {
    expect(
      await verifyPassword(DEV_BACKOFFICE_PASSWORD, example.BACKOFFICE_PASSWORD_HASH ?? ""),
    ).toBe(true);
  });

  it("prints the dev password only when the configured hash verifies against it", async () => {
    expect(await backofficeLines({ origin, env: example, showDevPassword: true })).toEqual([
      "  backoffice: https://parcela.localhost:8443/backoffice",
      "  usuário: operador",
      "  senha: senha-de-teste",
    ]);
    const own = { ...example, BACKOFFICE_PASSWORD_HASH: "scrypt:16384:8:1:c2FsdA==:aGFzaA==" };
    expect((await backofficeLines({ origin, env: own, showDevPassword: true })).at(-1)).toBe(
      "  senha: a definida em BACKOFFICE_PASSWORD_HASH (.env.local)",
    );
  });

  it("never prints a password outside dev", async () => {
    const lines = await backofficeLines({ origin, env: example, showDevPassword: false });
    expect(lines.join("\n")).not.toMatch(/senha/);
  });
});

describe("proxy site", () => {
  it("serves *.localhost from Caddy's local CA, a public domain from ACME, a bare port over HTTP", () => {
    expect(proxySite({})).toEqual({
      scheme: "https",
      host: "parcela.localhost",
      port: "8443",
      issuer: "local",
    });
    expect(proxySite({ APP_DOMAIN: "", HTTPS_PORT: "9443" })).toMatchObject({
      host: "parcela.localhost",
      port: "9443",
    });
    expect(proxySite({ APP_DOMAIN: "parcela.example.com", HTTPS_PORT: "443" })).toEqual({
      scheme: "https",
      host: "parcela.example.com",
      port: "443",
      issuer: "acme",
    });
    expect(proxySite({ APP_DOMAIN: ":8080" })).toEqual({ scheme: "http", port: "8080" });

    expect(siteOrigin(proxySite({}))).toBe("https://parcela.localhost:8443");
    expect(siteOrigin(proxySite({ APP_DOMAIN: "parcela.example.com", HTTPS_PORT: "443" }))).toBe(
      "https://parcela.example.com",
    );
    expect(healthRequest(proxySite({ APP_DOMAIN: ":8080" }))).toEqual({
      url: "http://localhost:8080/api/health",
    });
    expect(
      healthRequest(proxySite({ APP_DOMAIN: "parcela.example.com", HTTPS_PORT: "443" })),
    ).toEqual({
      url: "https://localhost:443/api/health",
      init: {
        headers: { host: "parcela.example.com" },
        tls: { serverName: "parcela.example.com" },
      },
    });
  });
});

/** A prod-parity host whose shared .local/caddy holds `TEST_ROOT_PEM` as the local CA. */
function prodHost(env: Env) {
  const calls: Array<{ argv: string[]; env: Env }> = [];
  const exec: Exec = async (argv, options) => {
    calls.push({ argv: [...argv], env: options.env ?? {} });
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const requests: Array<HealthRequestInit | undefined> = [];
  const read: string[] = [];
  const trusted: Array<{ sha1: string; file: string }> = [];
  const log: string[] = [];
  const deps = {
    run: createRunner(exec, {}),
    engine: podman,
    fetch: (async (_url, init) => {
      requests.push(init);
      return HEALTHY;
    }) satisfies HealthFetch,
    sleep: async () => {},
    env,
    log: (line: string) => log.push(line),
    readFile: async (path: string) => {
      read.push(path);
      return path === DEV_CA_ROOT ? TEST_ROOT_PEM : null;
    },
    trust: async (localCa: LocalCa, file: string) => {
      trusted.push({ sha1: localCa.sha1, file });
      return true;
    },
  };
  return { deps, calls, requests, read, trusted, log };
}

describe("prod-parity stack (vp run up --prod)", () => {
  it("serves caddy-dev's CA from the shared .local/caddy, verifies TLS against it, prints the URLs without a password", async () => {
    const host = prodHost({
      BACKOFFICE_USERNAME: "operador",
      BACKOFFICE_PASSWORD_HASH: example.BACKOFFICE_PASSWORD_HASH,
    });
    expect(await runProdUp(host.deps)).toBe(0);

    expect(host.calls).toHaveLength(1);
    const [up] = host.calls;
    // caddy-dev holds the same ports: the prod `up` removes it as an orphan of compose.yaml.
    expect(up?.argv.slice(-6)).toEqual([
      "prod",
      "up",
      "-d",
      "--build",
      "--wait",
      "--remove-orphans",
    ]);
    // compose.yaml's caddy mounts `${CADDY_DATA:-caddy_data}`: here, caddy-dev's directory.
    expect(up?.env.CADDY_DATA).toBe(`./${DEV_CADDY_DATA}`);
    expect(host.read).toEqual([DEV_CA_ROOT]);
    expect(host.requests).toEqual([
      {
        headers: { host: "parcela.localhost:8443" },
        tls: { serverName: "parcela.localhost", ca: TEST_ROOT_PEM },
      },
    ]);
    // Already trusted by `vp run up`: ensureTrusted finds the fingerprint and stays silent.
    expect(host.trusted).toEqual([{ sha1: ca.sha1, file: DEV_CA_ROOT }]);
    expect(host.log).toEqual(
      expect.arrayContaining([
        "→ https://parcela.localhost:8443",
        "  backoffice: https://parcela.localhost:8443/backoffice",
        "  usuário: operador",
      ]),
    );
    expect(host.log.join("\n")).not.toMatch(/senha/);
  });

  it("uses the system's CAs for a public domain and plain HTTP for a bare port, trusting nothing", async () => {
    const acme = prodHost({ APP_DOMAIN: "parcela.example.com", HTTPS_PORT: "443" });
    expect(await runProdUp(acme.deps)).toBe(0);
    expect(acme.requests).toEqual([
      { headers: { host: "parcela.example.com" }, tls: { serverName: "parcela.example.com" } },
    ]);
    expect(acme.log).toContain("→ https://parcela.example.com");

    const plain = prodHost({ APP_DOMAIN: ":8080" });
    expect(await runProdUp(plain.deps)).toBe(0);
    expect(plain.requests).toEqual([undefined]);
    expect(plain.log).toContain("→ http://localhost:8080");

    for (const host of [acme, plain]) {
      expect(host.read).toEqual([]);
      expect(host.trusted).toEqual([]);
    }
  });
});
