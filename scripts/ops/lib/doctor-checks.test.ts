import { describe, expect, it } from "vite-plus/test";

import { type DoctorFacts, doctorChecks, type EnvFileFacts, formatCheck } from "./doctor-checks";

const localEnv: EnvFileFacts = {
  file: ".env.local",
  error: null,
  databaseUrl: "postgres://parcela:parcela@localhost:5432/parcela",
};

const ready: DoctorFacts = {
  engine: { name: "podman", bin: "podman" },
  engineVersion: "podman version 6.0.2",
  composeVersion: "Docker Compose version v5.1.3",
  bunVersion: "1.4.4",
  expectedBunVersion: "1.4.4",
  envFiles: [localEnv],
  database: {
    reachable: true,
    url: "postgres://parcela:parcela@localhost:5432/parcela",
    appliedMigrations: 2,
    availableMigrations: 2,
    pgBossVersion: 46,
    expectedPgBossVersion: 46,
  },
  ports: [
    { port: 3000, state: "free", setting: null },
    { port: 5432, state: "project", setting: "POSTGRES_PORT" },
    { port: 8080, state: "free", setting: "HTTP_PORT" },
    { port: 8443, state: "project", setting: "HTTPS_PORT" },
  ],
  platform: "win32",
  caddyPorts: [8080, 8443],
  unprivilegedPortStart: null,
  localCa: {
    file: ".local/caddy/caddy/pki/authorities/local/root.crt",
    commonName: "parcela-mais-case dev - 2026 ECC Root",
    stores: [
      {
        label: "Windows user Root store (Chrome, Edge, Firefox)",
        trusted: true,
        fix: "certutil -user -addstore Root x",
      },
    ],
    unsupported: null,
  },
  siteResolves: true,
  devUpstream: { reachable: true, detail: "http://192.168.160.1:3000" },
  devBinding: {
    ok: true,
    listen: "192.168.160.1",
    upstream: "192.168.160.1",
    note: "the vEthernet (WSL) adapter",
    lanReachable: false,
  },
};

describe("doctor readiness checks (RF-704)", () => {
  it("flags each failed readiness check with a hint", () => {
    expect(doctorChecks(ready).filter((check) => !check.ok)).toEqual([]);

    const broken: DoctorFacts = {
      ...ready,
      composeVersion: null,
      bunVersion: "1.3.9",
      envFiles: [{ ...localEnv, databaseUrl: "postgres://parcela:parcela@127.0.0.1:5432/parcela" }],
    };
    const failed = doctorChecks(broken).filter((check) => !check.ok);

    const byLabel = (pattern: RegExp) => failed.filter((check) => pattern.test(check.label));
    expect(byLabel(/^DATABASE_URL host/)).toEqual([
      expect.objectContaining({ detail: "127.0.0.1", hint: expect.stringMatching(/localhost/) }),
    ]);
    expect(byLabel(/^bun$/)).toEqual([
      expect.objectContaining({ detail: expect.stringContaining("1.4.4") }),
    ]);
    expect(byLabel(/^compose provider$/)).toHaveLength(1);
    for (const check of failed) {
      expect(check.hint, check.label).toMatch(/\S/);
      expect(formatCheck(check)).toMatch(/^✗ .+\n\s+fix: \S/);
    }
  });

  it("checks caddy's CA trust, its ports, parcela.localhost resolution and caddy-dev's route to vp dev", () => {
    const broken: DoctorFacts = {
      ...ready,
      ports: [
        { port: 3000, state: "busy", setting: null },
        { port: 8443, state: "busy", setting: "HTTPS_PORT" },
      ],
      localCa: {
        ...ready.localCa,
        stores: [
          {
            label: "Windows user Root store (Chrome, Edge, Firefox)",
            trusted: false,
            fix: "certutil -user -addstore Root x",
          },
        ],
      },
      siteResolves: false,
      devUpstream: { reachable: false, detail: "wget: can't connect to remote host" },
    };
    const checks = doctorChecks(broken);
    const find = (pattern: RegExp) => checks.find((check) => pattern.test(check.label));

    expect(find(/^port 8443$/)).toMatchObject({
      ok: false,
      hint: expect.stringMatching(/HTTPS_PORT.*vp run down/),
    });
    // The dev server's port has no setting and nothing to do with Caddy's ports.
    expect(find(/^port 3000$/)?.hint).toMatch(/dev server/);
    expect(find(/^port 3000$/)?.hint).not.toMatch(/8080|8443|_PORT/);
    expect(find(/^local CA/)).toMatchObject({
      ok: false,
      hint: expect.stringMatching(/vp run up.*certutil -user -addstore/),
    });
    const noCertutil = doctorChecks({
      ...ready,
      localCa: {
        ...ready.localCa,
        stores: [],
        unsupported: "certutil not found: install libnss3-tools",
      },
    });
    expect(noCertutil.find((check) => check.label.startsWith("local CA"))).toMatchObject({
      ok: false,
      hint: expect.stringMatching(/libnss3-tools/),
    });
    expect(find(/^caddy-dev → vp dev/)).toMatchObject({
      ok: false,
      hint: expect.stringMatching(/Firewall/),
    });
    // Browsers resolve *.localhost themselves and the ops scripts never ask the resolver: a warning.
    const resolution = find(/parcela\.localhost resolves/);
    expect(resolution).toMatchObject({
      ok: true,
      warning: true,
      hint: expect.stringMatching(/hosts/),
    });
    expect(formatCheck(resolution!)).toMatch(/^! /);
  });

  it("is not alarmed by what `vp run up` hasn't created or started yet", () => {
    const fresh: DoctorFacts = {
      ...ready,
      localCa: { ...ready.localCa, commonName: null, stores: [] },
      devUpstream: null,
    };
    const checks = doctorChecks(fresh);
    expect(checks.filter((check) => !check.ok)).toEqual([]);
    expect(checks.find((check) => check.label.startsWith("local CA"))?.detail).toMatch(
      /`vp run up` creates it/,
    );
    expect(checks.some((check) => /caddy-dev → vp dev/.test(check.label))).toBe(false);
  });

  it("shows where the dev server listens, warning when only a firewall keeps it off the LAN", () => {
    expect(doctorChecks(ready).find((check) => check.label === "dev server address")).toMatchObject(
      {
        ok: true,
        detail: expect.stringContaining("192.168.160.1:3000"),
      },
    );
    const podmanLinux: DoctorFacts = {
      ...ready,
      platform: "linux",
      devBinding: {
        ok: true,
        listen: "192.168.1.67",
        note: "wlp2s0's address",
        lanReachable: true,
      },
    };
    const warning = doctorChecks(podmanLinux).find((check) => check.label === "dev server address");
    expect(warning).toMatchObject({
      ok: true,
      warning: true,
      hint: expect.stringMatching(/firewall/),
    });
    const missing: DoctorFacts = {
      ...ready,
      devBinding: { ok: false, reason: "podman machine start" },
    };
    expect(doctorChecks(missing).find((check) => check.label === "dev server address")?.ok).toBe(
      false,
    );
  });

  it("on Linux, checks the port floor for an opt-in HTTPS_PORT=443", () => {
    const linux: DoctorFacts = {
      ...ready,
      platform: "linux",
      caddyPorts: [8080, 443],
      unprivilegedPortStart: 1024,
    };
    expect(
      doctorChecks(linux).find((check) => check.label === "unprivileged port start"),
    ).toMatchObject({
      ok: false,
      hint: expect.stringMatching(/ip_unprivileged_port_start=443/),
    });
    expect(
      doctorChecks({ ...linux, unprivilegedPortStart: 443 }).find(
        (check) => check.label === "unprivileged port start",
      )?.ok,
    ).toBe(true);
  });
});
