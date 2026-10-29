#!/usr/bin/env bun
/**
 * First step of `vp run up` (RF-714): creates `.env.local` as a copy of `.env.example` when it doesn't
 * exist; an existing one is never touched. The example's keys are dev-only, and keeping them stable
 * matters: `vp run down` keeps the database, and new PII keys would leave every stored CPF
 * undecryptable. It runs as its own process before `up.ts`, because Bun reads `.env.local` once,
 * when a process starts.
 */
import { copyFileSync, constants, existsSync } from "node:fs";

import { scriptLog } from "./lib/script-log";

const EXAMPLE = ".env.example";
const LOCAL = ".env.local";

if (!existsSync(LOCAL)) {
  // COPYFILE_EXCL: never overwrite, even if the file appeared since the check.
  copyFileSync(EXAMPLE, LOCAL, constants.COPYFILE_EXCL);
  scriptLog("up")(`✓ created ${LOCAL} from ${EXAMPLE}`);
}
