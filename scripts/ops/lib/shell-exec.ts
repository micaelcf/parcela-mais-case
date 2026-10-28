// Type-only: the entries pass Bun's `$` in, so this file stays importable under Node (`vp test`).
import type { $ as BunShell } from "bun";

import type { Exec } from "./run";

/** Adapts Bun Shell to `Exec`: argv elements are escaped one by one, never re-parsed by a shell. */
export function createShellExec(shell: typeof BunShell): Exec {
  return async (argv, { env, quiet }) => {
    try {
      const output = await shell`${[...argv]}`
        .nothrow()
        .env(env ? { ...env } : undefined)
        .quiet(quiet ?? false);
      return {
        exitCode: output.exitCode,
        stdout: output.stdout.toString(),
        stderr: output.stderr.toString(),
      };
    } catch (error) {
      // Bun Shell throws when the program itself can't be spawned (e.g. not installed).
      const message = error instanceof Error ? error.message : String(error);
      return { exitCode: 127, stdout: "", stderr: message };
    }
  };
}
