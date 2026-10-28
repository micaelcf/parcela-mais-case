import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * A readers–writer lock across Playwright workers for the stack's global lender kill switches.
 *
 * Journeys run while a lender switch is flipped would see that lender skipped, so every journey test
 * holds a shared lease and the kill-switch test takes the exclusive one. A waiting writer blocks new
 * readers, so it only waits for the journeys already running.
 */

const POLL_MS = 100;

function lockDir(): string {
  const dir = process.env.E2E_LOCK_DIR;
  if (!dir) throw new Error("E2E_LOCK_DIR is unset: run the suite through playwright.config.ts");
  return dir;
}

export type Release = () => Promise<void>;

/** Shared lease: waits while a writer holds or waits for the lock. */
export async function acquireShared(): Promise<Release> {
  const dir = lockDir();
  const writer = join(dir, "writer");
  const lease = join(dir, "readers", randomUUID());
  for (;;) {
    while (existsSync(writer)) await sleep(POLL_MS);
    await writeFile(lease, "");
    if (!existsSync(writer)) return () => rm(lease, { force: true });
    // A writer arrived between the check and the lease: step back so it isn't starved.
    await rm(lease, { force: true });
  }
}

/** Exclusive lock: blocks new readers at once, then waits for the current ones to finish. */
export async function acquireExclusive(): Promise<Release> {
  const dir = lockDir();
  const writer = join(dir, "writer");
  for (;;) {
    try {
      await mkdir(writer);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await sleep(POLL_MS);
    }
  }
  while ((await readdir(join(dir, "readers"))).length > 0) await sleep(POLL_MS);
  return () => rm(writer, { recursive: true, force: true });
}
