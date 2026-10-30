#!/usr/bin/env bun
/**
 * `vp run up`: Postgres + caddy-dev + migrations, trust for caddy-dev's local CA, then the app
 * (`vp dev`) and the worker in the foreground, each line prefixed with its process in its own colour
 * (and both logging through tslog, coloured, when this runs in a terminal); Ctrl-C stops both, the
 * containers keep running (RF-701). Ready once https://parcela.localhost:8443/api/health answers.
 * `vp run up --prod`: the `prod` compose profile behind Caddy, checked through `/api/health` (RF-702).
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";

import { $, spawn, which } from "bun";

import { devBinding, devProcessEnv } from "./lib/dev-binding";
import { gatherDevNetworkFacts } from "./lib/dev-network";
import { compose, detectEngine, devCompose } from "./lib/engine";
import { type HealthFetch, sleep } from "./lib/health";
import {
  DEV_CA_ROOT,
  DEV_CADDY_DATA,
  ensureTrusted,
  EXPOSE_CA_ROOT,
  trustPlan,
  waitForCa,
} from "./lib/local-ca";
import { assertLocalCommand, createRunner } from "./lib/run";
import { scriptLog } from "./lib/script-log";
import { createShellExec } from "./lib/shell-exec";
import { gatherTrustFacts } from "./lib/trust-facts";
import {
  backofficeLines,
  checkDevHealth,
  createLinePrefixer,
  devChildEnv,
  devOrigin,
  devProcesses,
  parseUpArgs,
  processPrefix,
  runDevSetup,
  runProdUp,
  type TrustCa,
} from "./lib/up-plan";

const log = scriptLog("up");

const parsed = parseUpArgs(process.argv.slice(2));
if (!parsed.ok) {
  log(`✗ ${parsed.error}`);
  process.exit(2);
}

const engine = detectEngine({
  env: process.env,
  which: (command) => which(command),
  exists: existsSync,
});
const run = createRunner(createShellExec($), process.env);

const healthFetch: HealthFetch = (url, init) =>
  fetch(url, init && { headers: { ...init.headers }, tls: init.tls && { ...init.tls } });
const trust: TrustCa = (ca, file) =>
  ensureTrusted(
    { run, log },
    ca,
    trustPlan(
      ca,
      gatherTrustFacts(file, (command) => which(command)),
    ),
  );

// Caddy's /data in both modes: a bind mount, created here so every engine accepts it.
mkdirSync(DEV_CADDY_DATA, { recursive: true });
const readLocalFile = async (path: string) =>
  existsSync(path) ? readFileSync(path, "utf8") : null;

/** Reads the CA root on the host; on Linux, first lets the host user read it (EXPOSE_CA_ROOT). */
const caRootReader = (caddy: string[]) => async (path: string) => {
  // Fails until Caddy has written the root; the caller polls.
  if (process.platform === "linux")
    await run([...caddy, "sh", "-c", EXPOSE_CA_ROOT], { quiet: true });
  return readLocalFile(path);
};

if (parsed.mode === "prod") {
  process.exit(
    await runProdUp({
      run,
      engine,
      fetch: healthFetch,
      sleep,
      env: process.env,
      log,
      readFile: caRootReader(compose(engine, "exec", "-T", "caddy")),
      trust,
    }),
  );
}

const binding = devBinding(gatherDevNetworkFacts(engine));
if (!binding.ok) {
  log(`✗ no address for the dev server that caddy-dev can reach: ${binding.reason}`);
  process.exit(1);
}
const setup = await runDevSetup({
  run,
  engine,
  composeEnv: binding.upstream ? { DEV_UPSTREAM_HOST: binding.upstream } : {},
  log,
});
if (setup !== 0) process.exit(setup);

const readDevCa = caRootReader(devCompose(engine, "exec", "-T", "caddy-dev"));
const ca = await waitForCa(() => readDevCa(DEV_CA_ROOT), sleep);
if (ca) await trust(ca, DEV_CA_ROOT);
else
  log(`! caddy-dev wrote no CA root at ${DEV_CA_ROOT}: browsers will warn about the certificate`);

async function forward(
  stream: ReadableStream<Uint8Array>,
  prefix: string,
  target: NodeJS.WriteStream,
): Promise<void> {
  const prefixer = createLinePrefixer(prefix, (text) => target.write(text));
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    prefixer.push(decoder.decode(chunk.value, { stream: true }));
  }
  prefixer.flush();
}

const childEnv = { ...process.env, ...devProcessEnv(process.env, binding.listen) };
// Colours only for a terminal that wants them; the children's own output is piped through here.
const colored = process.stdout.isTTY === true && !process.env.NO_COLOR;
const children = devProcesses(binding.listen).map((processInfo) => {
  const { name, argv } = processInfo;
  const env = devChildEnv(childEnv, name, colored);
  assertLocalCommand(argv, env);
  const child = spawn([...argv], {
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const prefix = processPrefix(processInfo, colored);
  const output = Promise.all([
    forward(child.stdout, prefix, process.stdout),
    forward(child.stderr, prefix, process.stderr),
  ]);
  return { name, child, output };
});

let interrupted = false;
const stopAll = () => {
  for (const { child } of children) if (child.exitCode === null) child.kill();
};
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    interrupted = true;
    stopAll();
  });
}

// Ready once the app answers through caddy-dev over TLS verified against its CA.
void (async () => {
  const origin = devOrigin(process.env);
  const health = await checkDevHealth({ fetch: healthFetch, sleep, env: process.env, ca });
  if (!health.ok) {
    log(`✗ ${origin}/api/health through caddy-dev: ${health.reason}`);
    log(
      `  the dev server listens on ${binding.listen}:3000; \`vp run doctor\` checks caddy-dev's route to it`,
    );
    return;
  }
  log(`✓ app, worker, postgres and caddy-dev are up (sha ${health.sha})`);
  log(`→ ${origin}`);
  for (const line of await backofficeLines({ origin, env: process.env, showDevPassword: true }))
    log(line);
})();

const first = await Promise.race(
  children.map(({ name, child }) => child.exited.then((code) => ({ name, code }))),
);
if (!interrupted) log(`✗ ${first.name} exited with code ${first.code}; stopping the other process`);
stopAll();
await Promise.all(children.map(({ child, output }) => Promise.all([child.exited, output])));
log("stopped app and worker (Postgres and caddy-dev keep running)");
process.exit(interrupted ? 0 : first.code || 1);
