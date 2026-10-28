import { X509Certificate } from "node:crypto";

import type { CommandResult, RunCommand } from "./run";
import type { Sleep } from "./health";

/**
 * Caddy's local CA (it issues the `*.localhost` certificates) and the OS trust stores that make
 * browsers accept it. Pure plans: the Bun entries gather the facts and run the commands through
 * the ops runner. Every command here only reads or writes the current user's own stores.
 */

/** The official image keeps Caddy's data in /data; the local CA's root sits here inside it. */
export const CONTAINER_CA_ROOT = "/data/caddy/pki/authorities/local/root.crt";
/**
 * Caddy's /data on this machine: caddy-dev's bind mount, and the prod `caddy`'s under
 * `vp run up --prod` (CADDY_DATA). One CA per machine, outliving `vp run prune`.
 */
export const DEV_CADDY_DATA = ".local/caddy";
export const DEV_CA_ROOT = `${DEV_CADDY_DATA}/caddy/pki/authorities/local/root.crt`;

export type LocalCa = {
  readonly pem: string;
  /** Subject CN, e.g. `parcela-mais-case dev - 2026 ECC Root` (Caddyfile `pki.ca.local.name`). */
  readonly commonName: string;
  /** SHA-1 fingerprint, uppercase hex without separators (what certutil and `security` print). */
  readonly sha1: string;
};

/** Parses a PEM root certificate; throws when it isn't one. */
export function describeCa(pem: string): LocalCa {
  const cert = new X509Certificate(pem);
  const commonName = /^CN=(.*)$/m.exec(cert.subject)?.[1] ?? cert.subject;
  return { pem, commonName, sha1: cert.fingerprint.replaceAll(":", "").toUpperCase() };
}

/**
 * Waits for Caddy to write its root (it does on first start, right after the admin API is up):
 * `read` returns the PEM or null while it isn't there yet.
 */
export async function waitForCa(
  read: () => Promise<string | null>,
  sleep: Sleep,
  attempts = 30,
): Promise<LocalCa | null> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const pem = await read();
    if (pem !== null && pem.includes("BEGIN CERTIFICATE")) return describeCa(pem);
    if (attempt < attempts) await sleep(500);
  }
  return null;
}

/** One user-level store a browser reads: how to ask it whether the CA is trusted, and how to add it. */
export type TrustStore = {
  readonly label: string;
  readonly check: readonly string[];
  /** Runs in order; the first may prompt (Windows dialog, macOS password). */
  readonly install: ReadonlyArray<readonly string[]>;
  trusted(result: CommandResult): boolean;
};

export type TrustPlan =
  | { readonly stores: readonly TrustStore[]; readonly prompt: string | null }
  /** Nothing can be trusted automatically here: why, and what to do about it. */
  | { readonly unsupported: string };

export type TrustFacts = {
  readonly platform: string;
  readonly home: string;
  /** Absolute path of the root certificate file. */
  readonly file: string;
  /** Linux: `certutil` (NSS tools) on PATH. */
  readonly certutil: boolean;
  /** Linux: whether `~/.pki/nssdb` exists (Chrome/Chromium create it on first run). */
  readonly nssUserDbExists: boolean;
  /** Linux: Firefox profile directories that hold a `cert9.db`. */
  readonly firefoxProfiles: readonly string[];
};

const exitedZero = (result: CommandResult) => result.exitCode === 0;

/** Linux NSS nickname: the CA's name plus a fingerprint prefix, so a regenerated CA is a new entry. */
export function nssNickname(ca: LocalCa): string {
  return `${ca.commonName} ${ca.sha1.slice(0, 8)}`;
}

function nssStore(
  label: string,
  db: string,
  ca: LocalCa,
  file: string,
  create: boolean,
): TrustStore {
  const nickname = nssNickname(ca);
  const add = ["certutil", "-d", `sql:${db}`, "-A", "-t", "C,,", "-n", nickname, "-i", file];
  return {
    label,
    check: ["certutil", "-d", `sql:${db}`, "-L", "-n", nickname],
    install: create ? [["certutil", "-d", `sql:${db}`, "-N", "--empty-password"], add] : [add],
    trusted: exitedZero,
  };
}

export const LINUX_CERTUTIL_HINT =
  "install certutil (Debian/Ubuntu: sudo apt install libnss3-tools; Fedora: sudo dnf install nss-tools), then rerun vp run up";

const PLANS: Record<string, (ca: LocalCa, facts: TrustFacts) => TrustPlan> = {
  // The user Root store: Chrome, Edge and Firefox (≥ 120, enterprise roots) all read it. No admin.
  win32: (ca, { file }) => ({
    stores: [
      {
        label: "Windows user Root store (Chrome, Edge, Firefox)",
        check: ["certutil", "-user", "-verifystore", "Root", ca.sha1],
        install: [["certutil", "-user", "-addstore", "Root", file]],
        trusted: exitedZero,
      },
    ],
    prompt: "Windows asks once to confirm the new root: answer Yes",
  }),
  // The login keychain: Safari, Chrome and Firefox (enterprise roots) read it.
  darwin: (ca, { file, home }) => {
    const keychain = `${home}/Library/Keychains/login.keychain-db`;
    return {
      stores: [
        {
          label: "macOS login keychain (Safari, Chrome, Firefox)",
          check: ["security", "find-certificate", "-a", "-Z", "-c", ca.commonName, keychain],
          install: [["security", "add-trusted-cert", "-r", "trustRoot", "-k", keychain, file]],
          trusted: (result) =>
            result.exitCode === 0 && result.stdout.toUpperCase().includes(`SHA-1 HASH: ${ca.sha1}`),
        },
      ],
      prompt: "macOS asks for your password (or Touch ID) to change trust settings",
    };
  },
  // No OS store reaches every browser: Chrome/Chromium read the NSS user db, each Firefox profile
  // keeps its own cert9.db. No sudo: only the user's own databases.
  linux: (ca, facts) => {
    if (!facts.certutil) return { unsupported: `certutil not found: ${LINUX_CERTUTIL_HINT}` };
    return {
      stores: [
        nssStore(
          "NSS user db ~/.pki/nssdb (Chrome, Chromium)",
          `${facts.home}/.pki/nssdb`,
          ca,
          facts.file,
          !facts.nssUserDbExists,
        ),
        ...facts.firefoxProfiles.map((profile) =>
          nssStore(`Firefox profile ${profile}`, profile, ca, facts.file, false),
        ),
      ],
      prompt: null,
    };
  },
};

export function trustPlan(ca: LocalCa, facts: TrustFacts): TrustPlan {
  const plan = Object.hasOwn(PLANS, facts.platform) ? PLANS[facts.platform] : undefined;
  return plan
    ? plan(ca, facts)
    : {
        unsupported: `no automatic trust on ${facts.platform}: import ${facts.file} as a trusted root`,
      };
}

/** `a b "c d"`: a command a user can paste. */
export function shellLine(argv: readonly string[]): string {
  return argv.map((arg) => (/[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg)).join(" ");
}

export type StoreStatus = {
  readonly label: string;
  readonly trusted: boolean;
  /** The commands that add the CA to this store, pasteable. */
  readonly fix: string;
};

/** Asks every store of the plan (read-only): what `doctor` reports. */
export async function trustStatus(run: RunCommand, plan: TrustPlan): Promise<StoreStatus[]> {
  if ("unsupported" in plan) return [];
  const statuses: StoreStatus[] = [];
  for (const store of plan.stores) {
    statuses.push({
      label: store.label,
      trusted: store.trusted(await run(store.check, { quiet: true })),
      fix: store.install.map(shellLine).join(" && "),
    });
  }
  return statuses;
}

/**
 * Trusts the CA in every store that doesn't yet. Silent when all already do. A declined prompt or a
 * missing tool never fails `up`: it warns with the manual command and returns false.
 */
export async function ensureTrusted(
  deps: { run: RunCommand; log: (line: string) => void },
  ca: LocalCa,
  plan: TrustPlan,
): Promise<boolean> {
  const { run, log } = deps;
  if ("unsupported" in plan) {
    log(`! ${ca.commonName} is not trusted: ${plan.unsupported}`);
    return false;
  }
  let allTrusted = true;
  for (const store of plan.stores) {
    if (store.trusted(await run(store.check, { quiet: true }))) continue;
    log(`trusting ${ca.commonName} in the ${store.label}`);
    if (plan.prompt) log(`  ${plan.prompt}`);
    let installed = true;
    for (const argv of store.install) {
      if ((await run(argv)).exitCode !== 0) {
        installed = false;
        break;
      }
    }
    if (installed && store.trusted(await run(store.check, { quiet: true }))) continue;
    allTrusted = false;
    log(
      `! the ${store.label} does not trust ${ca.commonName}: browsers will warn about the certificate`,
    );
    for (const argv of store.install) log(`  to trust it later, run: ${shellLine(argv)}`);
  }
  return allTrusted;
}
