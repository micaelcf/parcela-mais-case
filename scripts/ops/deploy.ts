#!/usr/bin/env bun
/** `vp run deploy`, on the target host itself: clean tree → build → up → sha check → cleanup. */
import { existsSync } from "node:fs";

import { $, which } from "bun";

import { runDeploy } from "./lib/deploy-plan";
import { detectEngine } from "./lib/engine";
import { sleep } from "./lib/health";
import { createRunner } from "./lib/run";
import { createShellExec } from "./lib/shell-exec";

const args = process.argv.slice(2);
if (args.length > 0) {
  console.error(
    `✗ unknown option(s): ${args.join(" ")} (deploy takes none and only acts on this host)`,
  );
  process.exit(2);
}

const engine = detectEngine({
  env: process.env,
  which: (command) => which(command),
  exists: existsSync,
});
const run = createRunner(createShellExec($), process.env);

process.exit(
  await runDeploy({
    run,
    engine,
    fetch: (url, init) =>
      fetch(url, init && { headers: { ...init.headers }, tls: init.tls && { ...init.tls } }),
    sleep,
    env: process.env,
    log: (line) => console.log(line),
  }),
);
