import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vite-plus/test";

/**
 * TanStack Start's import protection stubs `*.client.*` modules in the server environment (and
 * `*.server.*` ones in the browser). A server file named that way loads fine in tests, which call
 * the app in-process, but hangs every request in the real server: the CEP lookup did exactly that.
 */
const ENVIRONMENT_SUFFIX = /\.(client|server)\.[^/]+$/;

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(process.cwd(), join(entry.parentPath, entry.name)).replaceAll("\\", "/"),
    );
}

describe("server file names", () => {
  it("never use the client/server suffixes TanStack Start strips per environment", () => {
    const files = ["src/server", "src/lib"].flatMap(filesUnder);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => ENVIRONMENT_SUFFIX.test(file))).toEqual([]);
  });
});
