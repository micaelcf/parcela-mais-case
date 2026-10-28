import { type AddressLookup, normalizeCep } from "#/lib/address/address";
import { type ViaCepClient, viaCepClient } from "#/server/integrations/viacep/viacep.adapter";
import { DomainError } from "#/server/lib/errors/domain-error";
import { logger } from "#/server/lib/log/logger";

/** At most this many CEPs are remembered; the least recently used one goes first. */
export const CACHE_MAX_ENTRIES = 1_000;
export const FOUND_TTL_MS = 24 * 60 * 60_000;
export const NOT_FOUND_TTL_MS = 60 * 60_000;

/** A remembered answer; `null` = ViaCEP doesn't know the CEP. Unavailable answers are never kept. */
type CacheEntry = { address: AddressLookup | null; expiresAt: number };

export type AddressService = { lookup(cep: string): Promise<AddressLookup> };

export function createAddressService(deps: {
  client: ViaCepClient;
  now?: () => number;
}): AddressService {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();

  function cached(digits: string): CacheEntry | undefined {
    const entry = cache.get(digits);
    if (!entry) return undefined;
    cache.delete(digits);
    if (entry.expiresAt <= now()) return undefined;
    // Re-inserted last: the Map's insertion order is the recency order.
    cache.set(digits, entry);
    return entry;
  }

  function remember(digits: string, address: AddressLookup | null): void {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    const ttl = address ? FOUND_TTL_MS : NOT_FOUND_TTL_MS;
    cache.set(digits, { address, expiresAt: now() + ttl });
  }

  /** ViaCEP's answer, logged once per call without the CEP. */
  async function fetchUpstream(digits: string): Promise<CacheEntry["address"]> {
    const started = performance.now();
    const result = await deps.client.lookup(digits);
    const latencyMs = Math.round(performance.now() - started);
    if (result.outcome === "unavailable") {
      logger.warn("address.lookup", { outcome: result.outcome, reason: result.reason, latencyMs });
      throw new DomainError(
        "ADDRESS_LOOKUP_UNAVAILABLE",
        "Não foi possível consultar o CEP agora. Preencha o endereço.",
      );
    }
    logger.info("address.lookup", { outcome: result.outcome, latencyMs });
    const address = result.outcome === "found" ? result.address : null;
    remember(digits, address);
    return address;
  }

  return {
    /**
     * The address of a CEP (masked or bare), from the cache or ViaCEP. Throws `CEP_NOT_FOUND`
     * for a CEP ViaCEP doesn't know and `ADDRESS_LOOKUP_UNAVAILABLE` when it can't answer.
     */
    async lookup(cep) {
      const digits = normalizeCep(cep);
      const entry = cached(digits);
      const address = entry ? entry.address : await fetchUpstream(digits);
      if (!address) throw new DomainError("CEP_NOT_FOUND", "CEP não encontrado.");
      return address;
    },
  };
}

export const addressService: AddressService = createAddressService({ client: viaCepClient });
