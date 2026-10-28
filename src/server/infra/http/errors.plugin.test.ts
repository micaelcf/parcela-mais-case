import { Elysia } from "elysia";
import Type from "typebox";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { DomainError } from "#/server/lib/errors/domain-error";

import { errorsPlugin } from "./errors.plugin";

const Body = Type.Object({
  cpf: Type.Refine(
    Type.String(),
    (value) => value === "52998224725",
    () => "CPF inválido",
  ),
});

describe("errorsPlugin", () => {
  describe("in production", () => {
    beforeAll(() => {
      vi.stubEnv("NODE_ENV", "production");
    });
    afterAll(() => {
      vi.unstubAllEnvs();
    });

    it("keeps field details in production", async () => {
      // Elysia reads NODE_ENV when it loads, so this case re-imports it under production.
      vi.resetModules();
      const elysia = await import("elysia");
      const plugin = await import("./errors.plugin");
      const app = new elysia.Elysia()
        .use(plugin.errorsPlugin)
        .post("/x", { body: Body }, ({ body }) => body);

      const response = await app.handle(
        new Request("http://localhost/x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cpf: "52998224724" }),
        }),
      );

      expect(response.status).toBe(422);
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      expect(await response.json()).toMatchObject({
        status: 422,
        code: "VALIDATION",
        fields: [{ path: "cpf", message: "CPF inválido" }],
      });
    });
  });

  it("maps a domain error to its status and code", async () => {
    const app = new Elysia().use(errorsPlugin).get("/x", () => {
      throw new DomainError("CHOICE_CONFLICT", "Outra oferta já foi escolhida.");
    });

    const response = await app.handle(new Request("http://localhost/x"));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CHOICE_CONFLICT", status: 409 });
  });

  it("answers malformed JSON with 422 VALIDATION, not a 500", async () => {
    const app = new Elysia().use(errorsPlugin).post("/x", { body: Body }, ({ body }) => body);

    const response = await app.handle(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "VALIDATION" });
  });

  it("answers a body sent as text/plain with 422 VALIDATION, not a 500", async () => {
    // fetch sends `text/plain;charset=UTF-8` for a string body without headers. A route with its
    // own `parse` hook (throttle, backoffice guard) never reaches Elysia's 415, so both shapes of
    // route must give the same answer.
    const plain = new Elysia().use(errorsPlugin).post("/x", { body: Body }, ({ body }) => body);
    const withParseHook = new Elysia()
      .use(errorsPlugin)
      .post("/x", { parse: () => undefined, body: Body }, ({ body }) => body);

    for (const app of [plain, withParseHook]) {
      const response = await app.handle(
        new Request("http://localhost/x", {
          method: "POST",
          headers: { "content-type": "text/plain;charset=UTF-8" },
          body: JSON.stringify({ cpf: "52998224725" }),
        }),
      );

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        type: "urn:parcela:error:validation",
        title: "Dados inválidos",
        status: 422,
        code: "VALIDATION",
        detail: "Envie o corpo como JSON (Content-Type: application/json).",
      });
    }
  });

  it("answers an unexpected error with 500 INTERNAL and no internals", async () => {
    const app = new Elysia().use(errorsPlugin).get("/x", () => {
      throw new Error("connect ECONNREFUSED postgres:5432 password=s3cret");
    });

    const response = await app.handle(new Request("http://localhost/x"));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(JSON.parse(text)).toEqual({
      type: "urn:parcela:error:internal",
      title: "Erro interno",
      status: 500,
      code: "INTERNAL",
    });
    expect(text).not.toMatch(/ECONNREFUSED|s3cret|postgres/);
  });
});
