import { describe, expect, it } from "vite-plus/test";

import { hashPassword, verifyPassword } from "./password";

const BASE64 = "[A-Za-z0-9+/]+={0,2}";

describe("backoffice password hashing (RF-601)", () => {
  it("hashes and verifies scrypt passwords", async () => {
    const encoded = await hashPassword("correct horse battery staple");

    const match = new RegExp(`^scrypt:16384:8:1:(${BASE64}):(${BASE64})$`).exec(encoded);
    expect(match, encoded).not.toBeNull();
    expect(Buffer.from(match?.[1] ?? "", "base64")).toHaveLength(16);
    expect(Buffer.from(match?.[2] ?? "", "base64")).toHaveLength(64);
    expect(encoded).not.toContain("$");
    expect(await hashPassword("correct horse battery staple")).not.toBe(encoded);

    expect(await verifyPassword("correct horse battery staple", encoded)).toBe(true);
    expect(await verifyPassword("correct horse battery stapler", encoded)).toBe(false);
    expect(await verifyPassword("", encoded)).toBe(false);

    const [, n, r, p, salt, hash] = encoded.split(":");
    const malformed = [
      "",
      "not-a-hash",
      encoded.replaceAll(":", "$"),
      `bcrypt:${n}:${r}:${p}:${salt}:${hash}`,
      `scrypt:${n}:${r}:${p}:${salt}`,
      `scrypt:${n}:${r}:${p}::${hash}`,
      `scrypt:${n}:${r}:${p}:${salt}:`,
      `scrypt:${n}:${r}:${p}:${salt}:not*base64`,
      `scrypt:1000:${r}:${p}:${salt}:${hash}`,
      `scrypt:1073741824:${r}:${p}:${salt}:${hash}`,
      `scrypt:x:${r}:${p}:${salt}:${hash}`,
    ];
    for (const value of malformed) {
      expect(await verifyPassword("correct horse battery staple", value), value).toBe(false);
    }
  });
});
