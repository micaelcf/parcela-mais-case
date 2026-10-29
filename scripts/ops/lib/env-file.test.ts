import { readFileSync } from "node:fs";

import { parse } from "dotenv";
import { describe, expect, it } from "vite-plus/test";

import { GENERATED_KEYS, type GeneratedKey, newEnvLocal } from "./env-file";

const example = readFileSync(".env.example", "utf8");

describe(".env.local created by vp run up", () => {
  it("is .env.example with fresh secrets, keeping every other value and the comments", () => {
    const created = newEnvLocal(example, (key: GeneratedKey) => `fresh-${key}`);

    const values = parse(created);
    const original = parse(example);
    expect(Object.keys(values)).toEqual(Object.keys(original));
    for (const key of Object.keys(original)) {
      const generated = GENERATED_KEYS.some((name) => name === key);
      expect(values[key], key).toBe(generated ? `fresh-${key}` : original[key]);
    }
    expect(created).toContain("# PII protection: base64 of exactly 32 bytes each.");
  });
});
