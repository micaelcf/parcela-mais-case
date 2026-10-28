import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from "node:crypto";

/** OWASP-baseline scrypt cost; encoded into every hash so it can change without breaking old ones. */
const COST = { N: 16_384, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
/** Upper bound for parameters read from a stored hash (128·N·r bytes); rejects absurd values. */
const MAX_MEMORY = 64 * 1024 * 1024;

/** `scrypt:<N>:<r>:<p>:<saltB64>:<hashB64>`; `:` not `$`, because env-file loaders expand `$`. */
const ENCODED = /^scrypt:(\d+):(\d+):(\d+):([A-Za-z0-9+/]+={0,2}):([A-Za-z0-9+/]+={0,2})$/;

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  scrypt(password, salt, keyLength, { ...options, maxmem: MAX_MEMORY }, (error, key) =>
    error ? reject(error) : resolve(key),
  );
  return promise;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, KEY_BYTES, COST);
  return `scrypt:${COST.N}:${COST.r}:${COST.p}:${salt.toString("base64")}:${key.toString("base64")}`;
}

/** Constant-time comparison; false (never a throw) for a malformed or unusable encoded value. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = ENCODED.exec(encoded);
  if (!match) return false;
  const [, n, r, p, saltB64, hashB64] = match;
  const salt = Buffer.from(saltB64 ?? "", "base64");
  const expected = Buffer.from(hashB64 ?? "", "base64");
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const actual = await deriveKey(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    // Invalid cost parameters (N not a power of two, memory over the bound, …).
    return false;
  }
}
