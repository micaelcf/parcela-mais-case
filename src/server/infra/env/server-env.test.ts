import { describe, expect, it } from "vite-plus/test";

import { createServerEnv } from "./server-env";

describe("createServerEnv", () => {
  it("refuses an invalid PII key", () => {
    const missing = { ...process.env, PII_ENCRYPTION_KEY: undefined };
    const short = { ...process.env, PII_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") };

    expect(() => createServerEnv(missing)).toThrow(/PII_ENCRYPTION_KEY/);
    expect(() => createServerEnv(short)).toThrow(/PII_ENCRYPTION_KEY/);
  });

  it("coerces numbers and booleans and applies defaults", () => {
    const env = createServerEnv({
      ...process.env,
      SIMULATION_CONTROLS: "false",
      CONSULTATION_DEADLINE_MS: "1500",
      RATE_LIMIT_IP_MAX: undefined,
      RATE_LIMIT_LOOKUP_IP_MAX: undefined,
      VIACEP_BASE_URL: undefined,
      VIACEP_TIMEOUT_MS: "1500",
    });

    expect(env.SIMULATION_CONTROLS).toBe(false);
    expect(env.CONSULTATION_DEADLINE_MS).toBe(1500);
    expect(env.RATE_LIMIT_IP_MAX).toBe(30);
    expect(env.RATE_LIMIT_LOOKUP_IP_MAX).toBe(120);
    expect(env.VIACEP_BASE_URL).toBe("https://viacep.com.br");
    expect(env.VIACEP_TIMEOUT_MS).toBe(1500);
  });
});
