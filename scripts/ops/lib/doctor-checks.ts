import type { DevBinding } from "./dev-binding";
import { devCompose, type Engine } from "./engine";

/**
 * `vp run doctor` (RF-704): pure checks over facts the Bun entry gathers read-only. Each check is
 * one ✓/✗ line (or `!` for a warning that doesn't fail doctor); every ✗ and ! carries a fix hint.
 */

export type CheckResult = {
  readonly ok: boolean;
  readonly label: string;
  readonly detail: string;
  readonly hint?: string;
  /** ok, but worth a look: printed with `!`. */
  readonly warning?: boolean;
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

export type PortSetting = "POSTGRES_PORT" | "HTTP_PORT" | "HTTPS_PORT";

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
  /** Packages package.json declares that have no folder in node_modules. */
  readonly missingDependencies: readonly string[];
  /** Whether `.env.local` exists (`vp run up` creates it from `.env.example` when it doesn't). */
  readonly envLocalExists: boolean;
  /** null when no DATABASE_URL is configured anywhere. */
  readonly database: DatabaseFacts | null;
  /** `setting`: the .env key that moves the port; null for the dev server's fixed 3000. */
  readonly ports: ReadonlyArray<{
    readonly port: number;
    readonly state: PortState;
    readonly setting: PortSetting | null;
  }>;
  readonly platform: NodeJS.Platform;
  /** Host ports Caddy publishes (HTTP_PORT, HTTPS_PORT). */
  readonly caddyPorts: readonly number[];
  /** `/proc/sys/net/ipv4/ip_unprivileged_port_start`, Linux only. */
  readonly unprivilegedPortStart: number | null;
  /** Caddy's local CA on this machine (caddy-dev and `up --prod`'s caddy share it). */
  readonly localCa: LocalCaFacts;
  /** Whether this host's resolver maps parcela.localhost to loopback. */
  readonly siteResolves: boolean;
  /** caddy-dev's request to `vp dev`, or null while either isn't running. */
  readonly devUpstream: { readonly reachable: boolean; readonly detail: string } | null;
  /** Where `vp run up` binds `vp dev` on this machine (dev-binding.ts). */
  readonly devBinding: DevBinding;
};

export type LocalCaFacts = {
  readonly file: string;
  /** null while the CA doesn't exist yet. */
  readonly commonName: string | null;
  /** Each user store a browser reads; `fix` is the command that adds the CA to it. */
  readonly stores: ReadonlyArray<{
    readonly label: string;
    readonly trusted: boolean;
    readonly fix: string;
  }>;
  /** Why no store can be checked here (e.g. Linux without certutil), or null. */
  readonly unsupported: string | null;
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
        hint: "bun run up creates .env.local (dev); cp .env.example .env for up --prod / deploy",
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
        hint: "bun run up creates .env.local with it",
      },
    ];
  }
  if (!database.reachable) {
    return [
      {
        ok: false,
        label: "database reachable",
        detail: database.error,
        hint: `start Postgres: ${devCompose(engine, "up", "-d", "--wait", "postgres").join(" ")} (or vp run up)`,
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

/** What a busy port blocks, and how to move it. */
const PORT_HINT: Record<PortSetting, string> = {
  POSTGRES_PORT: "or change POSTGRES_PORT in .env",
  HTTP_PORT:
    "or change HTTP_PORT in .env; `vp run up` and `vp run up --prod` both publish it: `vp run down` stops either",
  HTTPS_PORT:
    "or change HTTPS_PORT in .env; `vp run up` and `vp run up --prod` both publish it: `vp run down` stops either",
};

function checkPorts(ports: DoctorFacts["ports"]): CheckResult[] {
  return ports.map(({ port, state, setting }) =>
    state === "busy"
      ? {
          ok: false,
          label: `port ${port}`,
          detail: PORT_DETAIL[state],
          hint: setting
            ? `stop whatever listens on ${port}, ${PORT_HINT[setting]}`
            : `stop whatever listens on ${port} (the dev server's port; an earlier \`vp run up\` still running?)`,
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

function checkLocalCa(localCa: LocalCaFacts): CheckResult[] {
  const label = `local CA (${localCa.file})`;
  if (localCa.commonName === null)
    return [{ ok: true, label, detail: "not created yet: `vp run up` creates it and trusts it" }];
  if (localCa.unsupported !== null)
    return [
      {
        ok: false,
        label,
        detail: `${localCa.commonName}: trust not checked`,
        hint: localCa.unsupported,
      },
    ];
  return localCa.stores.map((store) =>
    store.trusted
      ? { ok: true, label, detail: `${localCa.commonName} trusted in the ${store.label}` }
      : {
          ok: false,
          label,
          detail: `${localCa.commonName} is not trusted in the ${store.label}: browsers warn`,
          hint: `vp run up (it asks once), or: ${store.fix}`,
        },
  );
}

function checkSiteResolution(resolves: boolean): CheckResult {
  const label = "parcela.localhost resolves to loopback";
  return resolves
    ? { ok: true, label, detail: "yes" }
    : {
        ok: true,
        warning: true,
        label,
        detail:
          "not by this host's resolver (browsers resolve *.localhost themselves; the ops scripts don't ask)",
        hint: "for other tools, add `127.0.0.1 parcela.localhost` and `::1 parcela.localhost` to the hosts file (/etc/hosts; Windows: C:\\Windows\\System32\\drivers\\etc\\hosts)",
      };
}

/** Why caddy-dev may not reach `vp dev`, per host OS (see dev-binding.ts). */
const UPSTREAM_HINT: Partial<Record<NodeJS.Platform, string>> = {
  win32:
    "caddy-dev dials the vEthernet (WSL) address `vp dev` listens on: Windows Firewall must allow Node.js on that network, then restart vp run up",
  linux:
    "allow port 3000 from the container network (Docker: docker0; rootless Podman: pasta's host address) in ufw/firewalld",
  darwin:
    "`vp dev` listens on 127.0.0.1, where Podman's gvproxy and Docker Desktop forward host.containers.internal",
};

function checkDevUpstream(
  platform: NodeJS.Platform,
  upstream: DoctorFacts["devUpstream"],
): CheckResult[] {
  if (upstream === null) return [];
  const label = "caddy-dev → vp dev";
  if (upstream.reachable) return [{ ok: true, label, detail: upstream.detail }];
  return [
    {
      ok: false,
      label,
      detail: upstream.detail,
      hint: UPSTREAM_HINT[platform] ?? "make `vp dev` reachable from the caddy-dev container",
    },
  ];
}

function checkDevBinding(binding: DevBinding): CheckResult {
  const label = "dev server address";
  if (!binding.ok) return { ok: false, label, detail: binding.reason, hint: binding.reason };
  const detail = `${binding.listen}:3000 (${binding.note})`;
  return binding.lanReachable
    ? {
        ok: true,
        warning: true,
        label,
        detail,
        hint: "machines on that network reach port 3000 unless a firewall closes it (ufw deny 3000 / firewalld): rootless Podman can't reach the host's loopback",
      }
    : { ok: true, label, detail };
}

function checkDependencies(missing: readonly string[]): CheckResult {
  if (missing.length === 0) return { ok: true, label: "dependencies", detail: "installed" };
  const shown = missing.slice(0, 3).join(", ");
  return {
    ok: false,
    label: "dependencies",
    detail: `${missing.length} not installed (${shown}${missing.length > 3 ? ", …" : ""})`,
    hint: "bun run up installs them first (or bun install)",
  };
}

/** A warning, not a failure: `vp run up` creates it, and `--prod` reads `.env` instead. */
function checkEnvLocal(exists: boolean): CheckResult {
  return exists
    ? { ok: true, label: ".env.local", detail: "present" }
    : {
        ok: true,
        warning: true,
        label: ".env.local",
        detail: "missing",
        hint: "bun run up creates it as a copy of .env.example (or cp .env.example .env.local)",
      };
}

export function doctorChecks(facts: DoctorFacts): CheckResult[] {
  return [
    checkEngine(facts),
    ...checkComposeProvider(facts.engine, facts.composeVersion),
    checkBunVersion(facts.bunVersion, facts.expectedBunVersion),
    checkDependencies(facts.missingDependencies),
    checkEnvLocal(facts.envLocalExists),
    ...checkEnvFiles(facts.envFiles),
    ...facts.envFiles.flatMap(({ file, databaseUrl }) =>
      databaseUrl === undefined ? [] : [checkDatabaseUrlHost(file, databaseUrl)],
    ),
    ...checkDatabase(facts.engine, facts.database),
    ...checkPorts(facts.ports),
    ...checkUnprivilegedPorts(facts),
    ...checkLocalCa(facts.localCa),
    checkSiteResolution(facts.siteResolves),
    checkDevBinding(facts.devBinding),
    ...checkDevUpstream(facts.platform, facts.devUpstream),
  ];
}

export function formatCheck(check: CheckResult): string {
  const mark = !check.ok ? "✗" : check.warning ? "!" : "✓";
  const line = `${mark} ${check.label}: ${check.detail}`;
  return check.hint ? `${line}\n    fix: ${check.hint}` : line;
}
