import { setTimeout as delay } from "node:timers/promises";

import Type from "typebox";
import { Compile } from "typebox/compile";

import { assertLocalUrl } from "./run";

/** `GET /api/health` body (`system.routes.ts`). */
const HealthBody = Compile(Type.Object({ status: Type.Literal("ok"), sha: Type.String() }));

export type HealthResponse = { readonly status: number; json(): Promise<unknown> };
export type HealthFetch = (url: string) => Promise<HealthResponse>;
export type Sleep = (ms: number) => Promise<void>;

export const sleep: Sleep = (ms) => delay(ms);

export type HealthResult = { ok: true; sha: string } | { ok: false; reason: string };

export function healthUrl(httpPort: string): string {
  return `http://localhost:${httpPort}/api/health`;
}

/**
 * Polls `url` until it answers 200 with a valid health body, up to `attempts` times. Only network
 * errors and non-200 answers are retried: a valid answer is final.
 */
export async function checkHealth(input: {
  url: string;
  fetch: HealthFetch;
  sleep: Sleep;
  attempts?: number;
  delayMs?: number;
}): Promise<HealthResult> {
  assertLocalUrl(input.url);
  const attempts = input.attempts ?? 15;
  let reason = "no attempt made";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await input.fetch(input.url);
      if (response.status === 200) {
        const body = await response.json();
        if (HealthBody.Check(body)) return { ok: true, sha: body.sha };
        return { ok: false, reason: `unexpected health body ${JSON.stringify(body)}` };
      }
      reason = `HTTP ${response.status}`;
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) await input.sleep(input.delayMs ?? 1_000);
  }
  return { ok: false, reason };
}
