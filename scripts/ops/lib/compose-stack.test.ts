import { readFileSync } from "node:fs";

import { parse as parseDotenv } from "dotenv";
import Type, { type Static } from "typebox";
import { Compile } from "typebox/compile";
import { describe, expect, it } from "vite-plus/test";
import { parse as parseYaml } from "yaml";

import { runDeploy } from "./deploy-plan";
import type { Engine } from "./engine";
import { prunePlan } from "./prune-plan";
import { createRunner, type Exec } from "./run";
import { devSetupPlan, runProdUp } from "./up-plan";

const SHA = "4f2d9c1e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e";
const podman: Engine = { name: "podman", bin: "podman" };

const Scalar = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]);
const PortEntry = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Object({
    target: Type.Union([Type.String(), Type.Number()]),
    published: Type.Optional(Type.Union([Type.String(), Type.Number()])),
  }),
]);
const RawServiceSchema = Type.Object({
  ports: Type.Optional(Type.Array(PortEntry)),
  network_mode: Type.Optional(Type.String()),
  environment: Type.Optional(
    Type.Union([Type.Record(Type.String(), Scalar), Type.Array(Type.String())]),
  ),
});
const ComposeFile = Compile(
  Type.Object({ services: Type.Record(Type.String(), RawServiceSchema) }),
);
type RawService = Static<typeof RawServiceSchema>;
type Service = { ports: string[]; networkMode: string | null; environment: Map<string, string> };

function environmentEntries(raw: RawService["environment"]): Array<[string, string]> {
  if (raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw.map((line) => {
      const at = line.indexOf("=");
      return at === -1 ? [line, ""] : [line.slice(0, at), line.slice(at + 1)];
    });
  }
  return Object.entries(raw).map(([key, value]) => [key, value === null ? "" : String(value)]);
}

/** Compose's merge for the keys checked here: override `ports` append, `environment` keys win. */
function loadStack(files: readonly string[]): Map<string, Service> {
  const services = new Map<string, Service>();
  for (const file of files) {
    const parsed: unknown = parseYaml(readFileSync(file, "utf8"), { merge: true });
    if (!ComposeFile.Check(parsed)) throw new Error(`${file} is not a compose file`);
    for (const [name, raw] of Object.entries(parsed.services)) {
      const service: Service = services.get(name) ?? {
        ports: [],
        networkMode: null,
        environment: new Map(),
      };
      for (const entry of raw.ports ?? [])
        service.ports.push(
          typeof entry === "object" ? `${entry.published ?? ""}:${entry.target}` : String(entry),
        );
      service.networkMode = raw.network_mode ?? service.networkMode;
      for (const [key, value] of environmentEntries(raw.environment))
        service.environment.set(key, value);
      services.set(name, service);
    }
  }
  return services;
}

/** The `-f` files of one compose invocation. */
function composeFiles(argv: readonly string[]): string[] {
  return argv.flatMap((arg, i) => (argv[i - 1] === "-f" ? [arg] : []));
}

/** Every compose invocation `vp run up --prod` and a healthy `vp run deploy` make. */
async function prodComposeCalls(): Promise<string[][]> {
  const calls: string[][] = [];
  const exec: Exec = async (argv) => {
    calls.push([...argv]);
    const stdout = argv.join(" ") === "git rev-parse HEAD" ? `${SHA}\n` : "";
    return { exitCode: 0, stdout, stderr: "" };
  };
  const deps = {
    run: createRunner(exec, {}),
    engine: podman,
    fetch: async () => ({ status: 200, json: async () => ({ status: "ok", sha: SHA }) }),
    sleep: async () => {},
    httpPort: "8080",
    log: () => {},
  };
  expect(await runProdUp(deps)).toBe(0);
  expect(await runDeploy(deps)).toBe(0);
  return calls.filter((argv) => argv[1] === "compose");
}

/** `${NAME}`, `${NAME-}`, `${NAME:-}`, `${NAME?msg}`, `${NAME:?msg}`: from env, no literal default. */
const FROM_ENV_ONLY = /^\$\{[A-Za-z_]\w*(?::?-|:?\?[^}]*)?\}$/;
const CREDENTIAL_KEY = /PASSWORD|SECRET|TOKEN/i;
const URL_USERINFO = /:\/\/(?:\$\{[^}]*\}|[^\s:/@]+):(\$\{[^}]*\}|[^\s/@]+)@/g;

function literalCredentials(name: string, service: Service): string[] {
  const found: string[] = [];
  for (const [key, value] of service.environment) {
    if (CREDENTIAL_KEY.test(key) && !FROM_ENV_ONLY.test(value))
      found.push(`service ${name} sets ${key} to a literal in the prod stack`);
    for (const [, password] of value.matchAll(URL_USERINFO)) {
      if (!FROM_ENV_ONLY.test(password))
        found.push(`service ${name} has a literal password in ${key} in the prod stack`);
    }
  }
  return found;
}

/** A2 rule: in the prod stack only the proxy publishes host ports, and no credential is a literal. */
function prodStackViolations(stack: Map<string, Service>): string[] {
  return [...stack].flatMap(([name, service]) => [
    ...(name === "caddy"
      ? []
      : service.ports.map((port) => `service ${name} publishes ${port} in the prod stack`)),
    ...(service.networkMode === "host"
      ? [`service ${name} uses host networking in the prod stack`]
      : []),
    ...literalCredentials(name, service),
  ]);
}

/** `${NAME:-…${…` / `${NAME-…${…`: podman-compose < 1.6 ends the default at the first `}`. */
const NESTED_DEFAULT = /\$\{[A-Za-z_]\w*:?-[^}]*\$\{/;

/** Every string in a compose value, with the mapping key it sits under. */
function* keyedStrings(value: unknown, key: string): Generator<[string, string]> {
  if (typeof value === "string") yield [key, value];
  else if (Array.isArray(value)) for (const item of value) yield* keyedStrings(item, key);
  else if (typeof value === "object" && value !== null)
    for (const [child, item] of Object.entries(value)) yield* keyedStrings(item, child);
}

function nestedDefaults(file: string): string[] {
  const parsed: unknown = parseYaml(readFileSync(file, "utf8"), { merge: true });
  if (!ComposeFile.Check(parsed)) throw new Error(`${file} is not a compose file`);
  return Object.entries(parsed.services).flatMap(([name, raw]) =>
    [...keyedStrings(raw, name)]
      .filter(([, value]) => NESTED_DEFAULT.test(value))
      .map(([key]) => `service ${name} nests an interpolation inside a default in ${key}`),
  );
}

describe("compose stacks", () => {
  it("publishes only caddy and holds no literal credential in the prod stack", async () => {
    const calls = await prodComposeCalls();
    expect(calls.length).toBeGreaterThan(0);
    const fileSets = new Set(calls.map((argv) => composeFiles(argv).join(" ")));

    for (const files of fileSets) {
      const stack = loadStack(files.split(" "));
      expect(stack.get("caddy")?.ports.length ?? 0, files).toBeGreaterThan(0);
      expect(prodStackViolations(stack), files).toEqual([]);
    }
  });

  it("publishes Postgres for the dev flow with the credentials .env.example connects with", () => {
    const [postgresUp] = devSetupPlan(podman);
    const stack = loadStack(composeFiles(postgresUp));
    const postgres = stack.get("postgres");
    expect(postgres?.ports).toEqual([expect.stringMatching(/^\$\{POSTGRES_PORT:-5432\}:5432$/)]);

    // `vp run up` without a .env: compose falls back to each `${NAME:-default}`.
    const devValue = (key: string) =>
      (postgres?.environment.get(key) ?? "").replace(/^\$\{\w+:-([^}]*)\}$/, "$1");
    const example = parseDotenv(readFileSync(".env.example"));
    const url = new URL(example.DATABASE_URL ?? "");
    expect([url.username, url.password, url.pathname.slice(1), url.port]).toEqual([
      devValue("POSTGRES_USER"),
      devValue("POSTGRES_PASSWORD"),
      devValue("POSTGRES_DB"),
      "5432",
    ]);
    expect(devValue("POSTGRES_PASSWORD")).not.toBe("");
    expect([example.POSTGRES_USER, example.POSTGRES_PASSWORD, example.POSTGRES_DB]).toEqual([
      url.username,
      url.password,
      url.pathname.slice(1),
    ]);
  });

  it("never nests an interpolation inside a default", async () => {
    const calls = [
      ...(await prodComposeCalls()),
      ...devSetupPlan(podman),
      ...prunePlan(podman).commands,
    ];
    const files = new Set(
      calls.filter((argv) => argv[1] === "compose").flatMap((argv) => composeFiles(argv)),
    );
    expect([...files].sort()).toEqual(["compose.dev.yaml", "compose.yaml"]);

    for (const file of files) expect(nestedDefaults(file), file).toEqual([]);
  });
});
