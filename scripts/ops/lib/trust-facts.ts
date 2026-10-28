import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { TrustFacts } from "./local-ca";

/** Where Firefox keeps profiles on Linux: distro package, Snap, Flatpak. */
const FIREFOX_PROFILE_ROOTS = [
  ".mozilla/firefox",
  "snap/firefox/common/.mozilla/firefox",
  ".var/app/org.mozilla.firefox/.mozilla/firefox",
];

function firefoxProfiles(home: string): string[] {
  return FIREFOX_PROFILE_ROOTS.flatMap((root) => {
    const dir = join(home, root);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "cert9.db")))
      .map((entry) => join(dir, entry.name));
  });
}

/** Read-only facts `trustPlan` needs about this machine, for the root certificate at `file`. */
export function gatherTrustFacts(
  file: string,
  which: (command: string) => string | null,
): TrustFacts {
  const home = homedir();
  const linux = process.platform === "linux";
  return {
    platform: process.platform,
    home,
    file: resolve(file),
    certutil: linux ? which("certutil") !== null : true,
    nssUserDbExists: linux && existsSync(join(home, ".pki", "nssdb")),
    firefoxProfiles: linux ? firefoxProfiles(home) : [],
  };
}
