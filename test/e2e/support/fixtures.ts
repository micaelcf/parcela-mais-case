import { randomInt } from "node:crypto";

import { test as base } from "@playwright/test";

import { fakeAddressLookup, type LookupLog } from "./address-lookup";
import { acquireShared } from "./lender-switch-lock";
import { newPatient, type Patient } from "./patient";

export { expect } from "@playwright/test";

type Fixtures = {
  /** The address the app counts for this test's requests (no proxy in dev: it reads the header). */
  clientIp: string;
  /** A fresh applicant (unique CPF). */
  patient: Patient;
  /** The CEPs this test's pages looked up (every page answers from the fake in `address-lookup`). */
  addressLookups: LookupLog;
};

/**
 * Every test gets its own client IP and patient, so the live abuse limits (30 POSTs per IP per
 * route per hour, 5 consultations per CPF per day) never trip across tests or runs. CEP lookups
 * never reach ViaCEP: every page gets the deterministic fake.
 */
export const test = base.extend<Fixtures>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from the pattern.
  clientIp: async ({}, use) => {
    await use(`10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`);
  },
  extraHTTPHeaders: async ({ clientIp }, use) => {
    await use({ "X-Forwarded-For": clientIp });
  },
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from the pattern.
  patient: async ({}, use) => {
    await use(newPatient());
  },
  addressLookups: [
    async ({ context }, use) => {
      await use(await fakeAddressLookup(context));
    },
    { auto: true },
  ],
});

/**
 * Public journey tests: each holds a shared lease on the lender kill switches for its whole run,
 * so the backoffice kill-switch test never flips a lender under a running journey.
 */
export const journeyTest = test.extend<{ lenderSwitchLease: void }>({
  lenderSwitchLease: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from the pattern.
    async ({}, use) => {
      const release = await acquireShared();
      try {
        await use();
      } finally {
        await release();
      }
    },
    { auto: true },
  ],
});
