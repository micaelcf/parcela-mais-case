/**
 * Keys whose `.env.example` values are public, so a new `.env.local` gets fresh random ones: the PII
 * keys (base64 of 32 bytes) and the backoffice session secret.
 */
export const GENERATED_KEYS = [
  "PII_HMAC_KEY",
  "PII_ENCRYPTION_KEY",
  "BACKOFFICE_SESSION_SECRET",
] as const;
export type GeneratedKey = (typeof GENERATED_KEYS)[number];

const CREATED_HEADER = [
  "# Created by `vp run up` from .env.example, with fresh PII keys and session secret.",
  "# Yours to edit: `up` creates this file only when it's missing and never rewrites it.",
  "",
].join("\n");

const isGenerated = (key: string): key is GeneratedKey =>
  GENERATED_KEYS.some((generated) => generated === key);

/**
 * The `.env.local` that `vp run up` writes when there's none: `.env.example` as it is (comments
 * kept), with fresh values for the generated keys.
 */
export function newEnvLocal(example: string, secret: (key: GeneratedKey) => string): string {
  const body = example
    .split(/\r?\n/)
    .map((line) => {
      const key = /^([A-Z0-9_]+)=/.exec(line)?.[1];
      return key && isGenerated(key) ? `${key}=${secret(key)}` : line;
    })
    .join("\n");
  return `${CREATED_HEADER}${body}`;
}
