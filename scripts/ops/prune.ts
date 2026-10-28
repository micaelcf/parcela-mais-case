#!/usr/bin/env bun
/** `vp run prune`: local reset of this compose project (RF-705). */
import { existsSync } from "node:fs";

import { $, which } from "bun";

import { detectEngine } from "./lib/engine";
import { runPrune } from "./lib/prune-plan";
import { createRunner } from "./lib/run";
import { scriptLog } from "./lib/script-log";
import { createShellExec } from "./lib/shell-exec";

const engine = detectEngine({
  env: process.env,
  which: (command) => which(command),
  exists: existsSync,
});
const run = createRunner(createShellExec($), process.env);

process.exit(await runPrune({ run, engine, log: scriptLog("prune") }, process.argv.slice(2)));
