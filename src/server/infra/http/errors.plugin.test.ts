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
});
