import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite (RF-807): Playwright Test against an already running stack, Chromium only.
 * `E2E_BASE_URL` picks the stack: https://parcela.localhost:8443 by default, which is the dev stack
 * (`vp run up`, simulation controls on) or, while it runs instead, the prod-parity one
 * (`vp run up --prod`, where the proxy specs run). `vp dev` itself listens only on the address
 * caddy-dev reaches (`vp run doctor` prints it), not on `localhost:3000`.
 */
const baseURL = process.env.E2E_BASE_URL ?? "https://parcela.localhost:8443";

/** Caddy's local CA root, shared by both local stacks (scripts/ops/lib/local-ca.ts `DEV_CA_ROOT`). */
const CADDY_ROOT = resolve(".local/caddy/caddy/pki/authorities/local/root.crt");

// The browser trusts Caddy's CA through the OS store (`vp run up` adds it); Node never reads that
// store, so the workers' `request` and `fetch` get it here. Workers start after this runs and
// inherit the env; NODE_EXTRA_CA_CERTS is read once, at process start.
if (!process.env.NODE_EXTRA_CA_CERTS && existsSync(CADDY_ROOT)) {
  process.env.NODE_EXTRA_CA_CERTS = CADDY_ROOT;
}

export default defineConfig({
  testDir: "test/e2e",
  testMatch: "*.spec.ts",
  globalSetup: "./test/e2e/support/global-setup.ts",
  fullyParallel: true,
  // Every running consultation keeps four lender calls in flight on the stack's one worker; more
  // parallel journeys than this start queueing lender jobs and eat into the 10 s deadline.
  workers: 4,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  // Lenders answer in up to 15 s and every consultation settles by its 10 s deadline.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium" }],
});
