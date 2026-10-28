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
    { port: 3000, state: "free" },
    { port: 5432, state: "project" },
    { port: 8080, state: "free" },
  ],
  platform: "win32",
  caddyPorts: [8080, 8443],
  unprivilegedPortStart: null,
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
});
