import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { AddressLookup } from "#/lib/address/address";
import type { ViaCepResult } from "#/server/integrations/viacep/viacep.adapter";

import {
  CACHE_MAX_ENTRIES,
  createAddressService,
  FOUND_TTL_MS,
  NOT_FOUND_TTL_MS,
} from "./address.service";

const address = (cep: string): AddressLookup => ({
  cep,
  street: "Avenida Paulista",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
});

/** A service over a fake ViaCEP (`answer` per CEP digits) on a hand-driven clock. */
function serviceWith(answer: (cep: string) => ViaCepResult) {
  const calls: string[] = [];
  const clock = { now: 0 };
  const service = createAddressService({
    client: {
      lookup: async (cep) => {
        calls.push(cep);
        return answer(cep);
      },
    },
    now: () => clock.now,
  });
  return { service, calls, clock };
}

const found = (cep: string): ViaCepResult => ({ outcome: "found", address: address(cep) });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("address service", () => {
  it("answers from the cache for 24 h, masked or bare", async () => {
    const { service, calls, clock } = serviceWith(found);

    expect(await service.lookup("01310-100")).toEqual(address("01310100"));
    clock.now = FOUND_TTL_MS - 1;
    expect(await service.lookup("01310100")).toEqual(address("01310100"));
    expect(calls).toEqual(["01310100"]);

    clock.now = FOUND_TTL_MS;
    await service.lookup("01310100");
    expect(calls).toEqual(["01310100", "01310100"]);
  });

  it("remembers a not-found CEP for 1 h", async () => {
    const { service, calls, clock } = serviceWith(() => ({ outcome: "not_found" }));

    await expect(service.lookup("99999999")).rejects.toMatchObject({
      code: "CEP_NOT_FOUND",
      status: 404,
      detail: "CEP não encontrado.",
    });
    clock.now = NOT_FOUND_TTL_MS - 1;
    await expect(service.lookup("99999-999")).rejects.toMatchObject({ code: "CEP_NOT_FOUND" });
    expect(calls).toHaveLength(1);

    clock.now = NOT_FOUND_TTL_MS;
    await expect(service.lookup("99999999")).rejects.toMatchObject({ code: "CEP_NOT_FOUND" });
    expect(calls).toHaveLength(2);
  });

  it("never remembers an unavailable answer", async () => {
    const { service, calls } = serviceWith(() => ({ outcome: "unavailable", reason: "timeout" }));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(service.lookup("01310100")).rejects.toMatchObject({
        code: "ADDRESS_LOOKUP_UNAVAILABLE",
        status: 503,
        detail: "Não foi possível consultar o CEP agora. Preencha o endereço.",
      });
    }
    expect(calls).toHaveLength(2);
  });

  it("keeps at most the bound, evicting the least recently used CEP", async () => {
    // One log line per upstream call: keep the thousand of them out of the test output.
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { service, calls } = serviceWith(found);
    const cepOf = (index: number) => String(10_000_000 + index);

    for (let index = 0; index < CACHE_MAX_ENTRIES; index += 1) await service.lookup(cepOf(index));
    // Touch the oldest so the second oldest becomes the least recently used.
    await service.lookup(cepOf(0));
    await service.lookup(cepOf(CACHE_MAX_ENTRIES));
    expect(calls).toHaveLength(CACHE_MAX_ENTRIES + 1);

    await service.lookup(cepOf(0));
    expect(calls).toHaveLength(CACHE_MAX_ENTRIES + 1);
    await service.lookup(cepOf(1));
    expect(calls).toHaveLength(CACHE_MAX_ENTRIES + 2);
  });
});
