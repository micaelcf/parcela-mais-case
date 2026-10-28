import { createServer, type ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { logger } from "#/server/lib/log/logger";

/**
 * A fake ViaCEP on a free port. Each CEP picks a behaviour; `hits` counts the calls per CEP so a
 * cache hit is visible as a call that never arrived.
 */
const hits = new Map<string, number>();

const PAULISTA = {
  cep: "01310-100",
  logradouro: "Avenida Paulista",
  complemento: "de 612 a 1510 - lado par",
  unidade: "",
  bairro: "Bela Vista",
  localidade: "São Paulo",
  uf: "SP",
  estado: "São Paulo",
  regiao: "Sudeste",
  ibge: "3550308",
  gia: "1004",
  ddd: "11",
  siafi: "7107",
};

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

const elsewhere = (overrides: Partial<typeof PAULISTA>) => ({ ...PAULISTA, ...overrides });

const BEHAVIOURS: Record<string, (response: ServerResponse) => void> = {
  "01310100": (response) => sendJson(response, 200, PAULISTA),
  // A city-wide CEP: no street, no neighbourhood.
  "69945000": (response) =>
    sendJson(
      response,
      200,
      elsewhere({
        cep: "69945-000",
        logradouro: "",
        bairro: "",
        localidade: "Acrelândia",
        uf: "AC",
      }),
    ),
  "20040002": (response) =>
    sendJson(
      response,
      200,
      elsewhere({
        cep: "20040-002",
        logradouro: "Rua da Assembleia",
        bairro: "Centro",
        localidade: "Rio de Janeiro",
        uf: "RJ",
      }),
    ),
  "30130010": (response) =>
    sendJson(
      response,
      200,
      elsewhere({
        cep: "30130-010",
        logradouro: "Praça Sete de Setembro",
        bairro: "Centro",
        localidade: "Belo Horizonte",
        uf: "MG",
      }),
    ),
  "99999999": (response) => sendJson(response, 200, { erro: true }),
  "99999998": (response) => sendJson(response, 200, { erro: "true" }),
  "99999997": (response) => sendJson(response, 200, { erro: true }),
  "40000000": (response) => sendJson(response, 400, { message: "bad request" }),
  "50000000": (response) => sendJson(response, 500, { message: "boom" }),
  // Answers well after VIACEP_TIMEOUT_MS (300 ms): the real client timeout is what's under test.
  "50000001": (response) => {
    setTimeout(() => sendJson(response, 200, PAULISTA), 1_500);
  },
  "50000002": (response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html><body>Erro 502</body></html>");
  },
  "50000003": (response) => sendJson(response, 200, elsewhere({ uf: "XX" })),
};

const viaCep = createServer((request, response) => {
  const cep = /^\/ws\/(\d{8})\/json\/$/.exec(request.url ?? "")?.[1] ?? "";
  hits.set(cep, (hits.get(cep) ?? 0) + 1);
  const behaviour = BEHAVIOURS[cep];
  if (behaviour) behaviour(response);
  else sendJson(response, 404, { message: "unexpected path" });
});
const listening = Promise.withResolvers<void>();
viaCep.listen(0, "localhost", listening.resolve);
await listening.promise;
const bound = viaCep.address();
if (!bound || typeof bound === "string") throw new Error("fake ViaCEP has no TCP port");

// Must be set before any app module reads the env (dynamic imports below).
process.env.VIACEP_BASE_URL = `http://localhost:${bound.port}`;
process.env.VIACEP_TIMEOUT_MS = "300";
process.env.RATE_LIMIT_LOOKUP_IP_MAX = "4";
process.env.RATE_LIMIT_IP_MAX = "2";
process.env.RATE_LIMIT_IP_WINDOW_MINUTES = "60";

const { hashIp } = await import("#/server/lib/crypto/ip-hash");
const { throttleRepository } = await import("#/server/modules/throttle/throttle.repository");
const { appFetch, closeTestApp } = await import("../setup/app-fetch");
const { readProblem, uniqueIp, waitFor } = await import("../consultation/consultation-client");

afterAll(async () => {
  await closeTestApp();
  const closed = Promise.withResolvers<void>();
  viaCep.closeAllConnections();
  viaCep.close(() => closed.resolve());
  await closed.promise;
});

function lookup(cep: string, ip: string = uniqueIp()): Promise<Response> {
  return appFetch(`http://localhost/api/addresses/${cep}`, {
    headers: { "x-forwarded-for": ip },
  });
}

describe("GET /addresses/:cep", () => {
  it("answers a known CEP masked or bare", async () => {
    const masked = await lookup("01310-100");
    expect(masked.status).toBe(200);
    expect(await masked.json()).toEqual({
      cep: "01310100",
      street: "Avenida Paulista",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    });

    const cityWide = await lookup("69945000");
    expect(cityWide.status).toBe(200);
    expect(await cityWide.json()).toEqual({
      cep: "69945000",
      street: "",
      neighborhood: "",
      city: "Acrelândia",
      state: "AC",
    });
  });

  it("answers 404 CEP_NOT_FOUND for a CEP ViaCEP doesn't know", async () => {
    // `erro: true`, `erro: "true"`, HTTP 400.
    for (const cep of ["99999999", "99999-998", "40000000"]) {
      const response = await lookup(cep);
      expect([cep, response.status]).toEqual([cep, 404]);
      expect(response.headers.get("content-type")).toContain("application/problem+json");
      expect(await readProblem(response)).toMatchObject({
        code: "CEP_NOT_FOUND",
        title: "CEP não encontrado",
        detail: "CEP não encontrado.",
      });
    }
  });

  it("answers 503 ADDRESS_LOOKUP_UNAVAILABLE when ViaCEP can't answer", async () => {
    // HTTP 500, a timeout, a non-JSON body, a body outside the expected shape.
    for (const cep of ["50000000", "50000001", "50000002", "50000003"]) {
      const response = await lookup(cep);
      expect([cep, response.status]).toEqual([cep, 503]);
      expect(response.headers.get("content-type")).toContain("application/problem+json");
      expect(await readProblem(response)).toMatchObject({
        code: "ADDRESS_LOOKUP_UNAVAILABLE",
        title: "Consulta de CEP indisponível",
        detail: "Não foi possível consultar o CEP agora. Preencha o endereço.",
      });
    }
  });

  it("rejects a malformed CEP at the cep path without calling ViaCEP", async () => {
    const before = [...hits.values()].reduce((sum, count) => sum + count, 0);
    for (const cep of ["123", "1310-1000", "abcde-fgh", "00000-000"]) {
      const response = await lookup(cep);
      expect([cep, response.status]).toEqual([cep, 422]);
      const body = await readProblem(response);
      expect(body.code).toBe("VALIDATION");
      expect(body.fields).toEqual([{ path: "cep", message: "CEP inválido" }]);
    }
    expect([...hits.values()].reduce((sum, count) => sum + count, 0)).toBe(before);
  });

  it("serves a repeated lookup from the cache, never an unavailable answer", async () => {
    expect((await lookup("20040002")).status).toBe(200);
    const again = await lookup("20040-002");
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ street: "Rua da Assembleia", state: "RJ" });
    expect(hits.get("20040002")).toBe(1);

    // Not found is remembered too (looked up once in an earlier test).
    expect((await lookup("99999999")).status).toBe(404);
    expect(hits.get("99999999")).toBe(1);

    // Unavailable is never remembered: each lookup reaches ViaCEP again.
    const failed = hits.get("50000000") ?? 0;
    expect((await lookup("50000000")).status).toBe(503);
    expect((await lookup("50000000")).status).toBe(503);
    expect(hits.get("50000000")).toBe(failed + 2);
  });

  it("logs each upstream call once without the CEP", async () => {
    const lines: string[] = [];
    const detach = logger.attachTransport({
      format: "json",
      write: (_record, line) => {
        lines.push(line);
      },
    });
    try {
      expect((await lookup("30130010")).status).toBe(200);
      expect((await lookup("99999997")).status).toBe(404);
      expect((await lookup("50000002")).status).toBe(503);
      // Cached: no upstream call, no line.
      expect((await lookup("30130-010")).status).toBe(200);
    } finally {
      detach();
    }

    const lookups = lines.filter((line) => line.includes('"event":"address.lookup"'));
    expect(lookups).toEqual([
      expect.stringMatching(/"outcome":"found","latencyMs":\d+/),
      expect.stringMatching(/"outcome":"not_found","latencyMs":\d+/),
      expect.stringMatching(/"outcome":"unavailable","reason":"invalid_body","latencyMs":\d+/),
    ]);
    expect(lines.filter((line) => /30130|99999|50000/.test(line))).toEqual([]);
  });

  it("caps lookups per IP with their own limit", async () => {
    const ip = uniqueIp();
    // Above RATE_LIMIT_IP_MAX (2), within RATE_LIMIT_LOOKUP_IP_MAX (4).
    for (let sent = 0; sent < 4; sent += 1) {
      expect((await lookup("01310100", ip)).status).toBe(200);
    }
    const over = await lookup("01310100", ip);
    expect(over.status).toBe(429);
    expect((await readProblem(over)).code).toBe("IP_LIMIT");
    // A malformed CEP over the cap is refused the same way.
    const malformed = await lookup("123", ip);
    expect(malformed.status).toBe(429);
    expect((await readProblem(malformed)).code).toBe("IP_LIMIT");
    expect((await lookup("01310100")).status).toBe(200);

    const rows = await waitFor(
      () => throttleRepository.listByIpHmac(hashIp(ip)),
      (all) => all.length === 6 && all.every((row) => row.statusCode !== null),
    );
    expect(rows.map((row) => [row.route, row.statusCode, row.errorCode])).toEqual([
      ["address.lookup", 200, null],
      ["address.lookup", 200, null],
      ["address.lookup", 200, null],
      ["address.lookup", 200, null],
      ["address.lookup", 429, "IP_LIMIT"],
      ["address.lookup", 429, "IP_LIMIT"],
    ]);
  });
});
