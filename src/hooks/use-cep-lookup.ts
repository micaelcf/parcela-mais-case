import { useEffect, useEffectEvent, useState } from "react";

import { type AddressLookupResult, lookupAddress } from "#/api/addresses";
import { isCep, normalizeCep } from "#/lib/address/address";

/** `idle`: no complete CEP typed; `loading`: its lookup is running; else how that lookup ended. */
export type CepLookupStatus = "idle" | "loading" | AddressLookupResult["kind"];

/** A lookup's answer for one CEP (digits only). */
export type SettledCepLookup = { cep: string; result: AddressLookupResult };

/**
 * Looks `cep` up as soon as it's a valid CEP, aborting the lookup of a CEP since changed, and
 * calls `onResult` once per answer. Re-typing a CEP already found (or already unknown) reuses that
 * answer without a call; an unavailable lookup is retried. A `restored` answer (a reloaded draft)
 * counts as already looked up while its CEP stays: no call, no `onResult`, so the address typed
 * from it isn't refilled.
 */
export function useCepLookup(
  cep: string,
  onResult: (settled: SettledCepLookup) => void,
  restored: SettledCepLookup | null = null,
): CepLookupStatus {
  const digits = normalizeCep(cep);
  const valid = isCep(cep);
  const [settled, setSettled] = useState<(SettledCepLookup & { restored: boolean }) | null>(
    restored ? { ...restored, restored: true } : null,
  );
  const reuse =
    settled?.cep === digits &&
    (settled.restored || settled.result.kind === "found" || settled.result.kind === "not_found");
  const deliver = useEffectEvent(onResult);

  useEffect(() => {
    if (!valid || reuse) return;
    const controller = new AbortController();
    void lookupAddress(digits, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setSettled({ cep: digits, result, restored: false });
      deliver({ cep: digits, result });
    });
    return () => controller.abort();
  }, [digits, valid, reuse]);

  if (!valid) return "idle";
  return settled?.cep === digits ? settled.result.kind : "loading";
}
