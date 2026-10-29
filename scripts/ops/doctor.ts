#!/usr/bin/env bun
/**
 * `vp run doctor`: read-only readiness report (RF-704). Runs only version/listing commands, a
 * child `bun` that validates each env file against the server env schema, read-only SQL (in a
 * read-only session), TCP probes, trust-store lookups and one HTTP probe from inside caddy-dev.
 * Writes nothing.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { connect } from "node:net";
import { join } from "node:path";

import { $, version as bunVersion, which } from "bun";
import { parse } from "dotenv";
import { Client } from "pg";
import Type from "typebox";
import { Compile } from "typebox/compile";

import {
  type DatabaseFacts,
  type DoctorFacts,
  doctorChecks,
  type EnvFileFacts,
  formatCheck,
  type LocalCaFacts,
  type PortSetting,
  type PortState,
  publishedHostPorts,
} from "./lib/doctor-checks";
import { devBinding } from "./lib/dev-binding";
import { gatherDevNetworkFacts } from "./lib/dev-network";
import { COMPOSE_PROJECT_LABEL, detectEngine, devCompose } from "./lib/engine";
import { DEFAULT_APP_DOMAIN } from "./lib/health";
import { DEV_CA_ROOT, describeCa, trustPlan, trustStatus } from "./lib/local-ca";
import { createRunner, type RunCommand } from "./lib/run";
import { scriptLog } from "./lib/script-log";
import { createShellExec } from "./lib/shell-exec";
import { gatherTrustFacts } from "./lib/trust-facts";

const ENV_FILES = [".env.local", ".env"] as const;
const MIGRATIONS_FOLDER = "drizzle";

const RootPackage = Compile(
  Type.Object({
    devEngines: Type.Object({ packageManager: Type.Object({ version: Type.String() }) }),
  }),
);
const PgBossPackage = Compile(Type.Object({ pgboss: Type.Object({ schema: Type.Integer() }) }));
const DeclaredPackages = Compile(
  Type.Object({
    dependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
    devDependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
  }),
);

/** Declared packages with no folder in node_modules (read-only: nothing is installed here). */
function missingDependencies(rootPackage: unknown): string[] {
  if (!DeclaredPackages.Check(rootPackage)) return [];
  const declared = Object.keys({ ...rootPackage.dependencies, ...rootPackage.devDependencies });
  return declared.filter((name) => !existsSync(join("node_modules", name, "package.json")));
}

// Runs in a child `bun` per env file: importing server-env.ts validates `process.env` at module
// evaluation, so each file needs its own process (a static import here would validate ours).
const VALIDATE_ENV = `try { await import("#/server/infra/env/server-env"); } catch (error) {
  console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }`;

const exec = createShellExec($);
const run = createRunner(exec, process.env);
const engine = detectEngine({
  env: process.env,
  which: (command) => which(command),
  exists: existsSync,
});

async function output(runner: RunCommand, argv: readonly string[]): Promise<string | null> {
  const result = await runner(argv, { quiet: true });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Validates each env file alone: the child sees the shell env minus every key the files define. */
async function envFileFacts(): Promise<{
  files: EnvFileFacts[];
  values: Map<string, Record<string, string>>;
}> {
  const present = ENV_FILES.filter((file) => existsSync(file));
  const values = new Map(present.map((file) => [file, parse(readFileSync(file))]));
  const fileKeys = new Set([...values.values()].flatMap((parsed) => Object.keys(parsed)));
  const shellEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !fileKeys.has(key)),
  );
  const isolated = createRunner(exec, shellEnv);

  const files: EnvFileFacts[] = [];
  for (const file of present) {
    const result = await isolated(
      ["bun", "--no-env-file", `--env-file=${file}`, "-e", VALIDATE_ENV],
      {
        quiet: true,
      },
    );
    const error =
      result.exitCode === 0
        ? null
        : result.stderr
            .replace(/^Invalid environment variables:\s*/, "")
            .trim()
            .split(/\r?\n/)
            .join("; ");
    files.push({ file, error, databaseUrl: values.get(file)?.DATABASE_URL });
  }
  return { files, values };
}

function availableMigrations(): number {
  if (!existsSync(MIGRATIONS_FOLDER)) return 0;
  return readdirSync(MIGRATIONS_FOLDER, { withFileTypes: true }).filter(
    (entry) =>
      entry.isDirectory() && existsSync(join(MIGRATIONS_FOLDER, entry.name, "migration.sql")),
  ).length;
}

async function databaseFacts(url: string): Promise<DatabaseFacts> {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 3_000,
    application_name: "parcela-doctor",
    options: "-c default_transaction_read_only=on",
  });
  try {
    await client.connect();
  } catch (error) {
    return {
      reachable: false,
      url,
      error: error instanceof Error ? error.message || error.name : String(error),
    };
  }
  try {
    const applied = await client
      .query<{ n: number }>("select count(*)::int as n from drizzle.__drizzle_migrations")
      .then(
        (result) => result.rows[0]?.n ?? 0,
        () => 0,
      );
    const pgBossVersion = await client
      .query<{ version: number }>("select version from pgboss.version")
      .then(
        (result) => result.rows[0]?.version ?? null,
        () => null,
      );
    const pgBoss = readJson("node_modules/pg-boss/package.json");
    return {
      reachable: true,
      url,
      appliedMigrations: applied,
      availableMigrations: availableMigrations(),
      pgBossVersion,
      expectedPgBossVersion: PgBossPackage.Check(pgBoss) ? pgBoss.pgboss.schema : Number.NaN,
    };
  } finally {
    await client.end();
  }
}

/**
 * A TCP connect that succeeds means something listens: on `host`, or on localhost (either
 * loopback family) when no host is given.
 */
async function listening(port: number, host?: string): Promise<boolean> {
  const attempt = (target: { host: string; family?: 4 | 6 }) => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const socket = connect({ ...target, port });
    socket.setTimeout(1_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
    return promise;
  };
  if (host !== undefined) return attempt({ host });
  return (
    (await attempt({ host: "localhost", family: 6 })) ||
    (await attempt({ host: "localhost", family: 4 }))
  );
}

async function portFacts(
  ports: ReadonlyArray<{ port: number; setting: PortSetting | null; host?: string }>,
): Promise<DoctorFacts["ports"]> {
  const projectPs = await output(run, [
    engine.bin,
    "ps",
    "--filter",
    `label=${COMPOSE_PROJECT_LABEL}`,
    "--format",
    "{{.Ports}}",
  ]);
  const projectPorts = publishedHostPorts(projectPs ?? "");
  return Promise.all(
    ports.map(async ({ port, setting, host }) => {
      const busy = (await listening(port)) || (host !== undefined && (await listening(port, host)));
      const state: PortState = !busy ? "free" : projectPorts.has(port) ? "project" : "busy";
      return { port, state, setting };
    }),
  );
}

async function localCaFacts(file: string): Promise<LocalCaFacts> {
  if (!existsSync(file)) return { file, commonName: null, stores: [], unsupported: null };
  const ca = describeCa(readFileSync(file, "utf8"));
  const plan = trustPlan(
    ca,
    gatherTrustFacts(file, (command) => which(command)),
  );
  return {
    file,
    commonName: ca.commonName,
    stores: await trustStatus(run, plan),
    unsupported: "unsupported" in plan ? plan.unsupported : null,
  };
}

async function siteResolves(): Promise<boolean> {
  const addresses = await lookup(DEFAULT_APP_DOMAIN, { all: true }).catch(() => []);
  return (
    addresses.length > 0 &&
    addresses.every(({ address }) => address === "::1" || address.startsWith("127."))
  );
}

/** From inside caddy-dev, the request Caddy makes to `vp dev` (only while both run). */
async function devUpstreamFacts(): Promise<DoctorFacts["devUpstream"]> {
  const running = await output(run, devCompose(engine, "ps", "-q", "caddy-dev"));
  if (!running || !binding.ok || !(await listening(3000, binding.listen))) return null;
  const probe =
    'wget -q -T 10 -O /dev/null "http://$CADDY_UPSTREAM/api/health" 2>&1 && echo "http://$CADDY_UPSTREAM"';
  const result = await run(devCompose(engine, "exec", "-T", "caddy-dev", "sh", "-c", probe), {
    quiet: true,
  });
  const detail = `${result.stdout}${result.stderr}`.trim() || `exit ${result.exitCode}`;
  return { reachable: result.exitCode === 0, detail };
}

const binding = devBinding(gatherDevNetworkFacts(engine));
const rootPackage = readJson("package.json");
const env = await envFileFacts();
const databaseUrl =
  env.values.get(".env.local")?.DATABASE_URL ??
  env.values.get(".env")?.DATABASE_URL ??
  process.env.DATABASE_URL;
const httpPort = Number(process.env.HTTP_PORT ?? 8080);
const httpsPort = Number(process.env.HTTPS_PORT ?? 8443);

const facts: DoctorFacts = {
  engine,
  engineVersion: await output(run, [engine.bin, "--version"]),
  composeVersion: await output(run, [engine.bin, "compose", "version"]),
  bunVersion,
  expectedBunVersion: RootPackage.Check(rootPackage)
    ? rootPackage.devEngines.packageManager.version
    : "unknown (package.json devEngines)",
  envFiles: env.files,
  missingDependencies: missingDependencies(rootPackage),
  envLocalExists: existsSync(".env.local"),
  database: databaseUrl ? await databaseFacts(databaseUrl) : null,
  ports: await portFacts([
    { port: 3000, setting: null, host: binding.ok ? binding.listen : undefined },
    { port: Number(process.env.POSTGRES_PORT ?? 5432), setting: "POSTGRES_PORT" },
    { port: httpPort, setting: "HTTP_PORT" },
    { port: httpsPort, setting: "HTTPS_PORT" },
  ]),
  platform: process.platform,
  caddyPorts: [httpPort, httpsPort],
  unprivilegedPortStart:
    process.platform === "linux"
      ? Number(readFileSync("/proc/sys/net/ipv4/ip_unprivileged_port_start", "utf8").trim())
      : null,
  localCa: await localCaFacts(DEV_CA_ROOT),
  siteResolves: await siteResolves(),
  devUpstream: await devUpstreamFacts(),
  devBinding: binding,
};

const checks = doctorChecks(facts);
const log = scriptLog("doctor");
for (const check of checks) log(formatCheck(check));
process.exit(checks.every((check) => check.ok) ? 0 : 1);
