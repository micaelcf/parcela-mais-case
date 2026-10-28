import type { LenderCode } from "#/lib/enums";

import { LenderCallError, type LenderAdapterDeps } from "./lender.port";

/** HTTP and decimal plumbing shared by every `<lender>.adapter.ts` (mapping rules, lender-port.md). */

const timeoutError = () => new LenderCallError("TIMEOUT", false, "lender call aborted (deadline)");

export const unrecognisedResponse = (lender: LenderCode) =>
  new LenderCallError("INTEGRATION_ERROR", false, `${lender}: unrecognised response shape`);

/** Settles with `promise`, or rejects with a TIMEOUT error as soon as `signal` aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(timeoutError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(timeoutError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new LenderCallError("INTEGRATION_ERROR", false, "lender answered with a non-JSON body");
  }
}

/**
 * POSTs `payload` as JSON to `baseUrl + path` and returns the parsed 2xx body.
 * Throws `LenderCallError`: 5xx → LENDER_ERROR; aborted `signal` → TIMEOUT;
 * network failure, other non-2xx or a non-JSON body → INTEGRATION_ERROR.
 */
export async function postLenderJson(
  deps: LenderAdapterDeps,
  path: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    const response = await untilAborted(
      deps.fetch(`${deps.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      }),
      signal,
    );
    if (!response.ok) {
      response.body?.cancel().catch(() => undefined);
      const reason = response.status >= 500 ? "LENDER_ERROR" : "INTEGRATION_ERROR";
      throw new LenderCallError(
        reason,
        reason === "LENDER_ERROR",
        `lender answered HTTP ${response.status}`,
      );
    }
    return parseJson(await untilAborted(response.text(), signal));
  } catch (error) {
    if (error instanceof LenderCallError) throw error;
    if (signal.aborted) throw timeoutError();
    const detail = error instanceof Error ? error.message : String(error);
    throw new LenderCallError("INTEGRATION_ERROR", false, `lender call failed: ${detail}`);
  }
}

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** `round_half_up(value × 10^shift)` computed exactly on the decimal digits. */
function shiftHalfUp(value: number | string, shift: number): bigint {
  const match = DECIMAL.exec(typeof value === "number" ? String(value) : value);
  if (!match) {
    throw new LenderCallError("INTEGRATION_ERROR", false, "lender sent an unreadable decimal");
  }
  const fraction = match[2] ?? "";
  const digits = BigInt(match[1] + fraction);
  const num = digits * 10n ** BigInt(Math.max(shift - fraction.length, 0));
  const den = 10n ** BigInt(Math.max(fraction.length - shift, 0));
  return (2n * num + den) / (2n * den);
}

/** BRL decimals (`1234.56`, `"1234.565"`) → integer cents, half-up. */
export function decimalToCents(value: number | string): number {
  return Number(shiftHalfUp(value, 2));
}

export type RateUnit = "FRACTION" | "PERCENT" | "BPS";

const RATE_UNIT_EXPONENT: Record<RateUnit, number> = { FRACTION: 0, PERCENT: 2, BPS: 4 };

/** A monthly rate in `unit` → the canonical 6-decimal fraction string (`2.49` % → `"0.024900"`). */
export function decimalToMonthlyRate(value: number | string, unit: RateUnit): string {
  const micro = shiftHalfUp(value, 6 - RATE_UNIT_EXPONENT[unit]);
  return `${micro / 1_000_000n}.${(micro % 1_000_000n).toString().padStart(6, "0")}`;
}
