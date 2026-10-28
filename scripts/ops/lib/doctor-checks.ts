import { compose, type Engine } from "./engine";

/**
 * `vp run doctor` (RF-704): pure checks over facts the Bun entry gathers read-only. Each check is
 * one ✓/✗ line; every ✗ carries a fix hint.
 */

export type CheckResult = {
  readonly ok: boolean;
  readonly label: string;
  readonly detail: string;
  readonly hint?: string;
};

export type EnvFileFacts = {
  readonly file: string;
  /** Server env validation error (`server-env.ts`), or null when the file validates. */
  readonly error: string | null;
  readonly databaseUrl: string | undefined;
};

export type DatabaseFacts =
  | { readonly reachable: false; readonly url: string; readonly error: string }
  | {
      readonly reachable: true;
      readonly url: string;
      readonly appliedMigrations: number;
      readonly availableMigrations: number;
      readonly pgBossVersion: number | null;
      readonly expectedPgBossVersion: number;
    };

/** `project`: published by one of this compose project's containers (expected when it's up). */
export type PortState = "free" | "project" | "busy";

export type DoctorFacts = {
  readonly engine: Engine;
  /** `<engine> --version` output, or null when the engine didn't run. */
  readonly engineVersion: string | null;
  /** `<engine> compose version` output, or null when no compose provider answered. */
  readonly composeVersion: string | null;
  readonly bunVersion: string;
  /** `devEngines.packageManager.version` from package.json. */
  readonly expectedBunVersion: string;
  readonly envFiles: readonly EnvFileFacts[];
  /** null when no DATABASE_URL is configured anywhere. */
  readonly database: DatabaseFacts | null;
  readonly ports: ReadonlyArray<{ readonly port: number; readonly state: PortState }>;
  readonly platform: string;
  /** Host ports Caddy publishes (HTTP_PORT, HTTPS_PORT). */
  readonly caddyPorts: readonly number[];
  /** `/proc/sys/net/ipv4/ip_unprivileged_port_start`, Linux only. */
  readonly unprivilegedPortStart: number | null;
};

export type ComposeProvider = {
  readonly kind: "docker-compose" | "podman-compose";
  readonly version: string;
  readonly major: number;
  readonly minor: number;
};

/** Minimum versions honouring `depends_on.condition: service_completed_successfully`. */
const MIN_PROVIDER_VERSION: Record<ComposeProvider["kind"], readonly [number, number]> = {
  "docker-compose": [2, 0],
  "podman-compose": [1, 2],
};

const PROVIDER_PATTERNS: ReadonlyArray<readonly [ComposeProvider["kind"], RegExp]> = [
  ["docker-compose", /Docker Compose version v?(\d+)\.(\d+)(\.\d+)?/i],
  ["podman-compose", /podman-compose(?: version)?:? v?(\d+)\.(\d+)(\.\d+)?/i],
];

export function parseComposeProvider(output: string): ComposeProvider | null {
  for (const [kind, pattern] of PROVIDER_PATTERNS) {
    const match = pattern.exec(output);
    if (match) {
      const major = Number(match[1]);
      const minor = Number(match[2]);
      return { kind, major, minor, version: `${major}.${minor}${match[3] ?? ""}` };
    }
  }
  return null;
}

/** Host ports published by `<engine> ps --format {{.Ports}}` lines (`0.0.0.0:5432->5432/tcp`). */
export function publishedHostPorts(psPortsOutput: string): Set<number> {
  return new Set([...psPortsOutput.matchAll(/:(\d+)->/g)].map((match) => Number(match[1])));
}

const INSTALL_COMPOSE =
  "install Docker Compose v2+ (`podman compose` delegates to it) or podman-compose ≥ 1.2";

function checkEngine(facts: DoctorFacts): CheckResult {
  const label = `container engine (${facts.engine.name})`;
  return facts.engineVersion
    ? { ok: true, label, detail: facts.engineVersion }
    : {
        ok: false,
        label,
        detail: `\`${facts.engine.bin} --version\` failed`,
        hint: "install Podman (or Docker), or set CONTAINER_ENGINE=podman|docker",
      };
}

export function checkComposeProvider(engine: Engine, output: string | null): CheckResult[] {
  const provider = output === null ? null : parseComposeProvider(output);
  if (!provider) {
    const detail =
      output === null ? `\`${engine.name} compose\` has no provider` : "unknown provider";
    return [
      { ok: false, label: "compose provider", detail, hint: INSTALL_COMPOSE },
      {
        ok: false,
        label: "service_completed_successfully support",
        detail: "no compose provider",
        hint: INSTALL_COMPOSE,
      },
    ];
  }
  const [minMajor, minMinor] = MIN_PROVIDER_VERSION[provider.kind];
  const supported =
    provider.major > minMajor || (provider.major === minMajor && provider.minor >= minMinor);
  return [
    { ok: true, label: "compose provider", detail: `${provider.kind} ${provider.version}` },
    supported
      ? {
          ok: true,
          label: "service_completed_successfully support",
          detail: `${provider.kind} ${provider.version}`,
        }
      : {
          ok: false,
          label: "service_completed_successfully support",
          detail: `${provider.kind} ${provider.version} is too old`,
          hint: INSTALL_COMPOSE,
        },
  ];
}

export function checkBunVersion(actual: string, expected: string): CheckResult {
  return actual === expected
    ? { ok: true, label: "bun", detail: actual }
    : {
        ok: false,
        label: "bun",
        detail: `${actual}, package.json devEngines pins ${expected}`,
        hint: `bun upgrade --version ${expected} (or install bun ${expected})`,
      };
}

function checkEnvFiles(files: readonly EnvFileFacts[]): CheckResult[] {
  if (files.length === 0) {
    return [
      {
        ok: false,
        label: "env file",
        detail: "neither .env.local nor .env exists",
        hint: "cp .env.example .env.local (dev) and/or .env (up --prod, deploy)",
      },
    ];
  }
  return files.map(({ file, error }) =>
    error === null
      ? { ok: true, label: file, detail: "valid server env" }
      : {
          ok: false,
          label: file,
          detail: error,
          hint: `fix the listed variables in ${file} (see .env.example)`,
        },
  );
}

export function checkDatabaseUrlHost(file: string, url: string): CheckResult {
  const label = `DATABASE_URL host (${file})`;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return {
      ok: false,
      label,
      detail: "not a URL",
      hint: "use postgres://user:pass@localhost:5432/db",
    };
  }
  return hostname === "127.0.0.1"
    ? {
        ok: false,
        label,
        detail: "127.0.0.1",
        hint: "use localhost: Podman publishes ports on the IPv6 loopback only",
      }
    : { ok: true, label, detail: hostname };
}

function checkDatabase(engine: Engine, database: DatabaseFacts | null): CheckResult[] {
  if (database === null) {
    return [
      {
        ok: false,
        label: "database",
        detail: "no DATABASE_URL in .env.local, .env or the environment",
        hint: "cp .env.example .env.local",
      },
    ];
  }
  if (!database.reachable) {
    return [
      {
        ok: false,
        label: "database reachable",
        detail: database.error,
        hint: `start Postgres: ${compose(engine, "up", "-d", "--wait", "postgres").join(" ")} (or vp run up)`,
      },
    ];
  }
  const pending = database.availableMigrations - database.appliedMigrations;
  const boss = database.pgBossVersion;
  return [
    { ok: true, label: "database reachable", detail: "connected" },
    pending > 0
      ? {
          ok: false,
          label: "drizzle migrations",
          detail: `${pending} pending of ${database.availableMigrations}`,
          hint: "vp run db:migrate",
        }
      : { ok: true, label: "drizzle migrations", detail: `${database.appliedMigrations} applied` },
    boss !== null && boss >= database.expectedPgBossVersion
      ? { ok: true, label: "pg-boss schema", detail: `version ${boss}` }
      : {
          ok: false,
          label: "pg-boss schema",
          detail: `${boss === null ? "not installed" : `version ${boss}`}, expected ${database.expectedPgBossVersion}`,
          hint: "vp run db:migrate",
        },
  ];
}

const PORT_DETAIL: Record<PortState, string> = {
  free: "free",
  project: "in use by parcela-mais-case",
  busy: "in use by another process",
};

function checkPorts(ports: DoctorFacts["ports"]): CheckResult[] {
  return ports.map(({ port, state }) =>
    state === "busy"
      ? {
          ok: false,
          label: `port ${port}`,
          detail: PORT_DETAIL[state],
          hint: `stop whatever listens on ${port}, or change POSTGRES_PORT / HTTP_PORT in .env`,
        }
      : { ok: true, label: `port ${port}`, detail: PORT_DETAIL[state] },
  );
}

function checkUnprivilegedPorts(facts: DoctorFacts): CheckResult[] {
  const lowest = Math.min(...facts.caddyPorts);
  if (facts.platform !== "linux" || lowest >= 1024) return [];
  const start = facts.unprivilegedPortStart;
  const label = "unprivileged port start";
  return start !== null && start <= lowest
    ? [{ ok: true, label, detail: String(start) }]
    : [
        {
          ok: false,
          label,
          detail: `${start ?? "unknown"} > ${lowest}: rootless Caddy can't publish ${lowest}`,
          hint: `sudo sysctl net.ipv4.ip_unprivileged_port_start=${lowest}, or use HTTP_PORT/HTTPS_PORT ≥ 1024`,
        },
      ];
}

export function doctorChecks(facts: DoctorFacts): CheckResult[] {
  return [
    checkEngine(facts),
    ...checkComposeProvider(facts.engine, facts.composeVersion),
    checkBunVersion(facts.bunVersion, facts.expectedBunVersion),
    ...checkEnvFiles(facts.envFiles),
    ...facts.envFiles.flatMap(({ file, databaseUrl }) =>
      databaseUrl === undefined ? [] : [checkDatabaseUrlHost(file, databaseUrl)],
    ),
    ...checkDatabase(facts.engine, facts.database),
    ...checkPorts(facts.ports),
    ...checkUnprivilegedPorts(facts),
  ];
}

export function formatCheck(check: CheckResult): string {
  const line = `${check.ok ? "✓" : "✗"} ${check.label}: ${check.detail}`;
  return check.hint ? `${line}\n    fix: ${check.hint}` : line;
}
