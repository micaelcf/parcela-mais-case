import { createEnv } from "@t3-oss/env-core";
import Type, { type Static, type TSchema } from "typebox";

import { type StandardSchemaV1, toStandardSchema } from "#/lib/validation/standard-schema";

const Base64Key32 = Type.Refine(
  Type.String(),
  (value) => {
    const bytes = Buffer.from(value, "base64");
    return bytes.length === 32 && bytes.toString("base64") === value;
  },
  () => "deve ser uma chave base64 de 32 bytes",
);

const ScryptHash = Type.String({
  pattern: "^scrypt:\\d+:\\d+:\\d+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$",
});

const intAtLeast = (minimum: number, fallback: number) =>
  Type.Integer({ minimum, default: fallback });

const schema = {
  NODE_ENV: Type.Union(
    [Type.Literal("development"), Type.Literal("production"), Type.Literal("test")],
    { default: "development" },
  ),
  DATABASE_URL: Type.String({ pattern: "^postgres(ql)?://" }),
  PII_HMAC_KEY: Base64Key32,
  PII_ENCRYPTION_KEY: Base64Key32,
  PII_KEY_VERSION: intAtLeast(1, 1),
  BACKOFFICE_USERNAME: Type.String({ minLength: 1 }),
  BACKOFFICE_PASSWORD_HASH: ScryptHash,
  BACKOFFICE_SESSION_SECRET: Type.String({ minLength: 32 }),
  SIMULATION_CONTROLS: Type.Boolean({ default: false }),
  LENDER_BASE_URL: Type.String({
    pattern: "^https?://",
    default: "http://localhost:3000/api/simulator/lenders",
  }),
  CONSULTATION_DEADLINE_MS: intAtLeast(1, 10_000),
  SIMULATOR_TIME_SCALE: Type.Number({ exclusiveMinimum: 0, maximum: 1, default: 1 }),
  SIMULATOR_DELTA_FAILURE_RATE: Type.Number({ minimum: 0, maximum: 1, default: 0.3 }),
  RATE_LIMIT_PATIENT_MAX: intAtLeast(1, 5),
  RATE_LIMIT_PATIENT_WINDOW_HOURS: intAtLeast(1, 24),
  RATE_LIMIT_IP_MAX: intAtLeast(1, 30),
  RATE_LIMIT_IP_WINDOW_MINUTES: intAtLeast(1, 60),
  GIT_SHA: Type.String({ minLength: 1, default: "dev" }),
  APP_DOMAIN: Type.Union([Type.Undefined(), Type.String({ minLength: 1 })]),
} satisfies Record<string, TSchema>;

type Schema = typeof schema;

/** The validated server environment (bindings.md § Environment variables). */
export type ServerEnv = { readonly [K in keyof Schema]: Static<Schema[K]> };

const standard: Record<keyof Schema, StandardSchemaV1> = Object.fromEntries(
  Object.entries(schema).map(([key, type]) => [key, toStandardSchema(type, { coerce: true })]),
) as Record<keyof Schema, StandardSchemaV1>;

/** Validates a runtime env (normally `process.env`); throws naming every invalid variable. */
export function createServerEnv(runtimeEnv: Record<string, string | undefined>): ServerEnv {
  const validated = createEnv({
    isServer: true,
    server: standard,
    runtimeEnv,
    emptyStringAsUndefined: true,
    onValidationError(issues) {
      const lines = issues.map((issue) => {
        const key = issue.path?.map(String).join(".") ?? "?";
        return `${key}: ${issue.message}`;
      });
      throw new Error(`Invalid environment variables:\n${lines.join("\n")}`);
    },
  });
  // Every key went through its TypeBox schema above, so the shape is ServerEnv.
  return validated as unknown as ServerEnv;
}

export const env: ServerEnv = createServerEnv(process.env);
