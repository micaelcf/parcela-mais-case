import { describe, expect, it } from "vite-plus/test";

import {
  describeCa,
  ensureTrusted,
  type LocalCa,
  nssNickname,
  type TrustFacts,
  trustPlan,
  trustStatus,
  waitForCa,
} from "./local-ca";
import { createRunner, type CommandResult, type Exec } from "./run";
import { TEST_ROOT_PEM, TEST_ROOT_SHA1 } from "./test-ca.fixture";

const ROOT_PEM = TEST_ROOT_PEM;
const SHA1 = TEST_ROOT_SHA1;
const ca: LocalCa = describeCa(ROOT_PEM);

const facts = (overrides: Partial<TrustFacts>): TrustFacts => ({
  platform: "win32",
  home: "C:\\Users\\me",
  file: "C:\\repo\\.local\\caddy\\caddy\\pki\\authorities\\local\\root.crt",
  certutil: true,
  nssUserDbExists: true,
  firefoxProfiles: [],
  ...overrides,
});

/** Answers each command from `respond`; records what ran. */
function recording(respond: (argv: readonly string[]) => Partial<CommandResult>) {
  const executed: string[][] = [];
  const log: string[] = [];
  const exec: Exec = async (argv) => {
    executed.push([...argv]);
    return { exitCode: 0, stdout: "", stderr: "", ...respond(argv) };
  };
  return {
    deps: { run: createRunner(exec, {}), log: (line: string) => log.push(line) },
    executed,
    log,
  };
}

describe("Caddy local CA", () => {
  it("reads the root's name and SHA-1 fingerprint", () => {
    expect(ca.commonName).toBe("parcela-mais-case test - 2026 ECC Root");
    expect(ca.sha1).toBe(SHA1);
  });

  it("waits until Caddy has written the root", async () => {
    const answers = [null, null, ROOT_PEM];
    const sleeps: number[] = [];
    const found = await waitForCa(
      async () => answers.shift() ?? null,
      async (ms) => {
        sleeps.push(ms);
      },
    );
    expect(found?.sha1).toBe(SHA1);
    expect(sleeps).toHaveLength(2);

    expect(
      await waitForCa(
        async () => null,
        async () => {},
        3,
      ),
    ).toBeNull();
  });
});

describe("trust plan per platform", () => {
  it("Windows: the user Root store, checked by fingerprint, added with one confirmation", () => {
    const plan = trustPlan(ca, facts({}));
    if ("unsupported" in plan) throw new Error(plan.unsupported);
    expect(plan.stores.map(({ check, install }) => ({ check, install }))).toEqual([
      {
        check: ["certutil", "-user", "-verifystore", "Root", SHA1],
        install: [["certutil", "-user", "-addstore", "Root", facts({}).file]],
      },
    ]);
    expect(plan.prompt).toMatch(/Yes/);
  });

  it("macOS: the login keychain, matched by SHA-1 in `security find-certificate -Z`", () => {
    const plan = trustPlan(
      ca,
      facts({ platform: "darwin", home: "/Users/me", file: "/r/root.crt" }),
    );
    if ("unsupported" in plan) throw new Error(plan.unsupported);
    const [store] = plan.stores;
    const keychain = "/Users/me/Library/Keychains/login.keychain-db";
    expect(store?.check).toEqual([
      "security",
      "find-certificate",
      "-a",
      "-Z",
      "-c",
      ca.commonName,
      keychain,
    ]);
    expect(store?.install).toEqual([
      ["security", "add-trusted-cert", "-r", "trustRoot", "-k", keychain, "/r/root.crt"],
    ]);
    const listing = (sha1: string) => ({
      exitCode: 0,
      stderr: "",
      stdout: `SHA-256 hash: AB\nSHA-1 hash: ${sha1}\n`,
    });
    expect(store?.trusted(listing(SHA1))).toBe(true);
    // Another CA with the same name (a regenerated one) isn't this CA.
    expect(store?.trusted(listing("0".repeat(40)))).toBe(false);
    expect(store?.trusted({ exitCode: 44, stdout: "", stderr: "not found" })).toBe(false);
  });

  it("Linux: the NSS user db (created when missing) and every Firefox profile, no sudo", () => {
    const profiles = [
      "/home/me/.mozilla/firefox/abc.default-release",
      "/home/me/snap/firefox/common/.mozilla/firefox/x.default",
    ];
    const plan = trustPlan(
      ca,
      facts({
        platform: "linux",
        home: "/home/me",
        file: "/r/root.crt",
        nssUserDbExists: false,
        firefoxProfiles: profiles,
      }),
    );
    if ("unsupported" in plan) throw new Error(plan.unsupported);
    const nick = nssNickname(ca);
    expect(nick).toBe(`${ca.commonName} F2C23F7B`);
    const add = (db: string) => [
      "certutil",
      "-d",
      `sql:${db}`,
      "-A",
      "-t",
      "C,,",
      "-n",
      nick,
      "-i",
      "/r/root.crt",
    ];
    expect(
      plan.stores.map(({ check, install, directory }) => ({ check, install, directory })),
    ).toEqual([
      {
        check: ["certutil", "-d", "sql:/home/me/.pki/nssdb", "-L", "-n", nick],
        install: [
          ["certutil", "-d", "sql:/home/me/.pki/nssdb", "-N", "--empty-password"],
          add("/home/me/.pki/nssdb"),
        ],
        // certutil creates the database, not its directory (missing until Chrome first runs).
        directory: "/home/me/.pki/nssdb",
      },
      ...profiles.map((profile) => ({
        check: ["certutil", "-d", `sql:${profile}`, "-L", "-n", nick],
        install: [add(profile)],
        directory: undefined,
      })),
    ]);
    expect(plan.stores.flat().some((store) => store.install.flat().includes("sudo"))).toBe(false);
  });

  it("Linux without certutil: says which package installs it", () => {
    const plan = trustPlan(ca, facts({ platform: "linux", certutil: false }));
    expect(plan).toEqual({ unsupported: expect.stringMatching(/libnss3-tools.*nss-tools/) });
  });
});

describe("ensureTrusted", () => {
  it("is silent and changes nothing when every store already trusts the CA", async () => {
    const { deps, executed, log } = recording(() => ({ exitCode: 0 }));
    expect(await ensureTrusted(deps, ca, trustPlan(ca, facts({})))).toBe(true);
    expect(executed).toEqual([["certutil", "-user", "-verifystore", "Root", SHA1]]);
    expect(log).toEqual([]);
  });

  it("installs where missing, then confirms", async () => {
    let added = false;
    const { deps, executed, log } = recording((argv) => {
      if (argv.includes("-addstore")) added = true;
      return { exitCode: argv.includes("-verifystore") && !added ? 17 : 0 };
    });
    expect(await ensureTrusted(deps, ca, trustPlan(ca, facts({})))).toBe(true);
    expect(executed.map((argv) => argv[2])).toEqual(["-verifystore", "-addstore", "-verifystore"]);
    expect(log.join("\n")).toMatch(/Windows asks once/);
  });

  it("warns with the manual command when the prompt is declined, and doesn't fail", async () => {
    const { deps, log } = recording((argv) => ({ exitCode: argv.includes("-addstore") ? 1 : 17 }));
    expect(
      await ensureTrusted(deps, ca, trustPlan(ca, facts({ file: "C:\\my repo\\root.crt" }))),
    ).toBe(false);
    expect(log.join("\n")).toContain('run: certutil -user -addstore Root "C:\\my repo\\root.crt"');
  });

  it("warns without running anything when no tool can trust the CA", async () => {
    const { deps, executed, log } = recording(() => ({}));
    expect(
      await ensureTrusted(deps, ca, trustPlan(ca, facts({ platform: "linux", certutil: false }))),
    ).toBe(false);
    expect(executed).toEqual([]);
    expect(log.join("\n")).toMatch(/apt install libnss3-tools/);
  });

  it("reports each store's status read-only (doctor)", async () => {
    const { deps, executed } = recording((argv) => ({
      exitCode: argv.includes("sql:/p/ff") ? 255 : 0,
    }));
    const plan = trustPlan(
      ca,
      facts({ platform: "linux", home: "/h", firefoxProfiles: ["/p/ff"] }),
    );
    expect(await trustStatus(deps.run, plan)).toEqual([
      {
        label: "NSS user db ~/.pki/nssdb (Chrome, Chromium)",
        trusted: true,
        fix: expect.stringMatching(/^certutil -d sql:\/h\/.pki\/nssdb -A /),
      },
      {
        label: "Firefox profile /p/ff",
        trusted: false,
        fix: `certutil -d sql:/p/ff -A -t C,, -n "${nssNickname(ca)}" -i C:\\repo\\.local\\caddy\\caddy\\pki\\authorities\\local\\root.crt`,
      },
    ]);
    expect(executed.every((argv) => argv.includes("-L"))).toBe(true);
  });
});
