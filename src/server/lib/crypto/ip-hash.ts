import { createHmac } from "node:crypto";

import { env } from "#/server/infra/env/server-env";

const IP_PREFIX = "ip:v1:";

/** HMAC-SHA256(hmacKey, "ip:v1:" + ip): a stable, non-reversible key for per-IP counting. */
export function createIpHasher(hmacKey: Buffer): (ip: string) => Buffer {
  return (ip) => createHmac("sha256", hmacKey).update(`${IP_PREFIX}${ip}`).digest();
}

let fromEnv: ((ip: string) => Buffer) | undefined;

/** The env-keyed hasher (PII_HMAC_KEY), created on first use. */
export const hashIp = (ip: string): Buffer => {
  fromEnv ??= createIpHasher(Buffer.from(env.PII_HMAC_KEY, "base64"));
  return fromEnv(ip);
};
