import { defineConfig, lazyPlugins } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const GENERATED = ["src/routeTree.gen.ts"];

/** Test-only values; never valid outside a test run. Password: "senha-de-teste". */
const testEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://parcela:parcela@localhost:5432/parcela",
  PII_HMAC_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
  PII_ENCRYPTION_KEY: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=",
  BACKOFFICE_USERNAME: "operador",
  BACKOFFICE_PASSWORD_HASH:
    "scrypt:16384:8:1:cGFyY2VsYS10ZXN0LXNhbHQ=:kYUTfGWwMeDKXjxpWIvY/nTFRQqBWxfYHHysA+pxD5zKoT+kHW2oNgfQcx20aBvVJF5nxPQve7iot5I+NUudsQ==",
  BACKOFFICE_SESSION_SECRET: "test-session-secret-at-least-32-chars!!",
  SIMULATION_CONTROLS: "true",
  SIMULATOR_TIME_SCALE: "0.2",
  CONSULTATION_DEADLINE_MS: "2000",
  SIMULATOR_DELTA_FAILURE_RATE: "0.3",
  LENDER_BASE_URL: "http://localhost/api/simulator/lenders",
  GIT_SHA: "test-sha",
};

const config = defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: GENERATED,
  },
  lint: {
    ignorePatterns: GENERATED,
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        // RF-806: integration tests create data only through application code.
        files: ["test/integration/**/*.int.test.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["#/server/infra/db/client", "#/server/modules/*/db/*.table"],
                  message:
                    "Integration tests create and read data through services, repositories or the app, never the DB client or a table.",
                },
              ],
            },
          ],
        },
      },
      {
        // RFC D3: src/ runs on Node (vp dev, vp test) and Bun (containers); only scripts/ops may use Bun APIs.
        files: ["src/**/*.ts", "src/**/*.tsx"],
        rules: {
          "no-restricted-globals": [
            "error",
            { name: "Bun", message: "src/ must stay runtime-portable: use Web or node:* APIs." },
          ],
          "no-restricted-imports": [
            "error",
            {
              paths: [{ name: "bun", message: "src/ must stay runtime-portable." }],
              patterns: [{ group: ["bun:*"], message: "src/ must stay runtime-portable." }],
            },
          ],
        },
      },
    ],
  },
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
          env: testEnv,
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.int.test.ts"],
          env: testEnv,
          globalSetup: ["test/integration/setup/global-setup.ts"],
          setupFiles: ["test/integration/setup/file-db.setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
  // Tests exercise server and isomorphic code only; the app plugins (Start, nitro, devtools) would boot a dev app.
  plugins: process.env.VITEST
    ? []
    : lazyPlugins(() => [
        devtools(),
        nitro({ preset: "bun" }),
        tailwindcss(),
        tanstackStart(),
        viteReact(),
        babel({ presets: [reactCompilerPreset()] }),
      ]),
});

export default config;
