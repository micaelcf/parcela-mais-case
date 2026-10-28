import { describe, expect, it } from "vite-plus/test";

import type { FetchLike } from "#/server/integrations/lenders/lender.port";

import { createViaCepClient } from "./viacep.adapter";

const PAULISTA = {
  cep: "01310-100",
  logradouro: " Avenida Paulista ",
  complemento: "de 612 a 1510 - lado par",
  bairro: "Bela Vista",
  localidade: "São Paulo",
  uf: "SP",
  ibge: "3550308",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** A client whose every call answers with `answer`; `urls` records what it asked for. */
function clientAnswering(
  answer: FetchLike,
  options: { baseUrl?: string; timeoutMs?: number } = {},
) {
  const urls: string[] = [];
  const client = createViaCepClient({
    baseUrl: options.baseUrl ?? "https://viacep.test",
    timeoutMs: options.timeoutMs ?? 1_000,
    fetch: (input, init) => {
      urls.push(input instanceof Request ? input.url : String(input));
      return answer(input, init);
    },
  });
  return { client, urls };
}

describe("ViaCEP client", () => {
  it("maps a known CEP and asks for its 8 digits", async () => {
    const { client, urls } = clientAnswering(async () => json(200, PAULISTA), {
      baseUrl: "https://viacep.test/",
    });

    expect(await client.lookup("01310-100")).toEqual({
      outcome: "found",
      address: {
        cep: "01310100",
        street: "Avenida Paulista",
        neighborhood: "Bela Vista",
        city: "São Paulo",
        state: "SP",
      },
    });
    expect(urls).toEqual(["https://viacep.test/ws/01310100/json/"]);
  });

  it("keeps an empty street and neighbourhood of a city-wide CEP", async () => {
    const { client } = clientAnswering(async () =>
      json(200, { ...PAULISTA, cep: "69945-000", logradouro: "", bairro: "", uf: "AC" }),
    );

    expect(await client.lookup("69945000")).toMatchObject({
      outcome: "found",
      address: { cep: "69945000", street: "", neighborhood: "", state: "AC" },
    });
  });

  it("reads both erro shapes and HTTP 400 as not found", async () => {
    for (const answer of [json(200, { erro: true }), json(200, { erro: "true" }), json(400, {})]) {
      const { client } = clientAnswering(async () => answer);
      expect(await client.lookup("99999999")).toEqual({ outcome: "not_found" });
    }
  });

  it("reports every other failure as unavailable with its reason", async () => {
    const cases: Array<[FetchLike, string]> = [
      [async () => json(500, {}), "http_status"],
      [async () => json(404, {}), "http_status"],
      [async () => Promise.reject(new TypeError("fetch failed")), "network"],
      [async () => new Response("<html>Erro</html>", { status: 200 }), "invalid_body"],
      [async () => json(200, { ...PAULISTA, uf: "XX" }), "invalid_body"],
      [async () => json(200, { ...PAULISTA, localidade: undefined }), "invalid_body"],
      [async () => json(200, { erro: false }), "invalid_body"],
    ];
    for (const [answer, reason] of cases) {
      const { client } = clientAnswering(answer);
      expect([reason, await client.lookup("01310100")]).toEqual([
        reason,
        { outcome: "unavailable", reason },
      ]);
    }
  });

  it("gives up after the timeout", async () => {
    // Answers only when the request's own signal aborts, i.e. when the client's timeout fires.
    const { client } = clientAnswering(
      (_input, init) => {
        const { promise, reject } = Promise.withResolvers<Response>();
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        return promise;
      },
      { timeoutMs: 5 },
    );

    expect(await client.lookup("01310100")).toEqual({ outcome: "unavailable", reason: "timeout" });
  });
});
