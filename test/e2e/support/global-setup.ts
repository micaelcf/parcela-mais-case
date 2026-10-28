import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * One lock directory per run, shared by every worker through the environment (see
 * `lender-switch-lock.ts`): workers inherit the runner's `process.env` as global setup leaves it.
 */
export default async function globalSetup() {
  const dir = await mkdtemp(join(tmpdir(), "parcela-e2e-"));
  await mkdir(join(dir, "readers"));
  process.env.E2E_LOCK_DIR = dir;
}
