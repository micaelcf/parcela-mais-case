import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import { env } from "#/server/infra/env/server-env";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const BLIND_INDEX_PREFIX = "cpf:v1:";

export type CpfCrypto = {
  readonly keyVersion: number;
  blindIndex(cpfDigits: string): Buffer; // HMAC-SHA256(hmacKey, "cpf:v1:" + digits), 32 bytes
  encrypt(cpfDigits: string, aad: Buffer): Buffer; // iv(12) ‖ ct(11) ‖ tag(16) = 39 bytes, AES-256-GCM
  decrypt(ciphertext: Buffer, aad: Buffer): string; // throws on a wrong AAD or tampering
};

/** CPF blind index + AES-256-GCM sealing; the AAD binds a ciphertext to its blind index. */
export function createCpfCrypto(keys: {
  hmacKey: Buffer;
  encryptionKey: Buffer;
  keyVersion: number;
}): CpfCrypto {
  const { hmacKey, encryptionKey, keyVersion } = keys;
  return {
    keyVersion,
    blindIndex(cpfDigits) {
      return createHmac("sha256", hmacKey).update(`${BLIND_INDEX_PREFIX}${cpfDigits}`).digest();
    },
    encrypt(cpfDigits, aad) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, encryptionKey, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(aad);
      const body = Buffer.concat([cipher.update(cpfDigits, "utf8"), cipher.final()]);
      return Buffer.concat([iv, body, cipher.getAuthTag()]);
    },
    decrypt(ciphertext, aad) {
      if (ciphertext.length < IV_BYTES + TAG_BYTES) throw new Error("CPF ciphertext is too short");
      const iv = ciphertext.subarray(0, IV_BYTES);
      const tag = ciphertext.subarray(ciphertext.length - TAG_BYTES);
      const body = ciphertext.subarray(IV_BYTES, ciphertext.length - TAG_BYTES);
      const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    },
  };
}

let fromEnv: CpfCrypto | undefined;

function envCpfCrypto(): CpfCrypto {
  fromEnv ??= createCpfCrypto({
    hmacKey: Buffer.from(env.PII_HMAC_KEY, "base64"),
    encryptionKey: Buffer.from(env.PII_ENCRYPTION_KEY, "base64"),
    keyVersion: env.PII_KEY_VERSION,
  });
  return fromEnv;
}

/** The env-keyed instance (PII_HMAC_KEY, PII_ENCRYPTION_KEY, PII_KEY_VERSION), created on first use. */
export const cpfCrypto: CpfCrypto = {
  get keyVersion() {
    return envCpfCrypto().keyVersion;
  },
  blindIndex: (cpfDigits) => envCpfCrypto().blindIndex(cpfDigits),
  encrypt: (cpfDigits, aad) => envCpfCrypto().encrypt(cpfDigits, aad),
  decrypt: (ciphertext, aad) => envCpfCrypto().decrypt(ciphertext, aad),
};
