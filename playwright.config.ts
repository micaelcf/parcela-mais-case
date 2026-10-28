import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite (RF-807): Playwright Test against an already running stack, Chromium only.
 * `E2E_BASE_URL` picks the stack: the dev stack (`vp run up`, simulation controls on) by default,
 * Caddy (`vp run up --prod`, http://localhost:8080) for the proxy spec.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

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
