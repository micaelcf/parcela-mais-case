#!/usr/bin/env bun
/**
 * First step of `vp run up`: creates `.env.local` from `.env.example`, with fresh secrets, when it
 * doesn't exist; an existing one is never touched. It runs as its own process before `up.ts`,
 * because Bun reads `.env.local` once, when a process starts.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { type GeneratedKey, newEnvLocal } from "./lib/env-file";
import { scriptLog } from "./lib/script-log";

const EXAMPLE = ".env.example";
const LOCAL = ".env.local";

/** 32 random bytes: base64 for the PII keys' format; base64url (no `$`, `/`, `+`, `=`) for the secret. */
const SECRET: Record<GeneratedKey, () => string> = {
  PII_HMAC_KEY: () => randomBytes(32).toString("base64"),
  PII_ENCRYPTION_KEY: () => randomBytes(32).toString("base64"),
  BACKOFFICE_SESSION_SECRET: () => randomBytes(32).toString("base64url"),
};

if (!existsSync(LOCAL)) {
  writeFileSync(
    LOCAL,
    newEnvLocal(readFileSync(EXAMPLE, "utf8"), (key) => SECRET[key]()),
    {
      flag: "wx",
    },
  );
  scriptLog("up")(`✓ created ${LOCAL} from ${EXAMPLE} (fresh PII keys and session secret)`);
}
