#!/usr/bin/env bun
/** `vp run down [--stop]`: stop this compose project without deleting its data or images. */
import { existsSync } from "node:fs";

import { $, which } from "bun";

import { runDown } from "./lib/down-plan";
import { detectEngine } from "./lib/engine";
import { createRunner } from "./lib/run";
import { scriptLog } from "./lib/script-log";
import { createShellExec } from "./lib/shell-exec";

const engine = detectEngine({
  env: process.env,
  which: (command) => which(command),
  exists: existsSync,
});
const run = createRunner(createShellExec($), process.env);

process.exit(await runDown({ run, engine, log: scriptLog("down") }, process.argv.slice(2)));
