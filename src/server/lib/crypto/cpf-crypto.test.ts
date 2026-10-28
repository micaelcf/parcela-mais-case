import { describe, expect, it } from "vite-plus/test";

import { createCpfCrypto } from "./cpf-crypto";

const keys = {
  hmacKey: Buffer.alloc(32, 0x11),
  encryptionKey: Buffer.alloc(32, 0x22),
  keyVersion: 1,
};
const CPF = "52998224725";
const OTHER_CPF = "11144477735";

describe("CPF crypto", () => {
  it("round-trips without plaintext in the ciphertext", () => {
    const crypto = createCpfCrypto(keys);
    const aad = crypto.blindIndex(CPF);

    const first = crypto.encrypt(CPF, aad);
    const second = crypto.encrypt(CPF, aad);

    expect(first).toHaveLength(12 + 11 + 16);
    expect(first.includes(Buffer.from(CPF, "ascii"))).toBe(false);
    expect(first.equals(second)).toBe(false);
    expect(first.subarray(0, 12).equals(second.subarray(0, 12))).toBe(false);
    expect(crypto.decrypt(first, aad)).toBe(CPF);
    expect(crypto.decrypt(second, aad)).toBe(CPF);
  });

  it("refuses to decrypt under another blind index or after tampering", () => {
    const crypto = createCpfCrypto(keys);
    const aad = crypto.blindIndex(CPF);
    const sealed = crypto.encrypt(CPF, aad);

    expect(() => crypto.decrypt(sealed, crypto.blindIndex(OTHER_CPF))).toThrow();

    const tampered = Buffer.from(sealed);
    tampered[12] = (tampered[12] ?? 0) ^ 0x01;
    expect(() => crypto.decrypt(tampered, aad)).toThrow();
  });

  it("blind index is deterministic per key", () => {
    const crypto = createCpfCrypto(keys);
    const otherKey = createCpfCrypto({ ...keys, hmacKey: Buffer.alloc(32, 0x33) });

    const index = crypto.blindIndex(CPF);

    expect(index).toHaveLength(32);
    expect(crypto.blindIndex(CPF).equals(index)).toBe(true);
    expect(createCpfCrypto(keys).blindIndex(CPF).equals(index)).toBe(true);
    expect(otherKey.blindIndex(CPF).equals(index)).toBe(false);
    expect(crypto.blindIndex(OTHER_CPF).equals(index)).toBe(false);
  });
});
