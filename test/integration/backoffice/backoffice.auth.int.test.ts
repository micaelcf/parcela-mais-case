import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { closeTestApp } from "../setup/app-fetch";
import { readProblem, uniqueCpf } from "../consultation/consultation-client";
import {
  backofficeFetch,
  login,
  PASSWORD,
  postLogin,
  sessionCookieOf,
  signedSessionCookie,
  USERNAME,
} from "./backoffice-client";

afterAll(closeTestApp);

/**
 * Every backoffice route except `POST /session`, each with an otherwise valid request, plus
 * requests that would fail validation: the session is checked first, so they get 401, not 422.
 */
const GUARDED_ROUTES: ReadonlyArray<{ method: string; path: string; body?: unknown }> = [
  { method: "GET", path: "/session" },
  { method: "DELETE", path: "/session" },
  { method: "GET", path: "/metrics/pipeline" },
  { method: "GET", path: "/metrics/lenders" },
  { method: "GET", path: "/metrics/abuse" },
  { method: "PUT", path: "/lenders/delta/switch", body: { enabled: true } },
  { method: "GET", path: "/lenders/switch-log" },
  { method: "GET", path: "/consultations" },
  { method: "GET", path: `/consultations/${randomUUID()}` },
  { method: "POST", path: "/consultations/search-by-cpf", body: { cpf: uniqueCpf() } },
  { method: "GET", path: "/throttle-events" },
  { method: "PUT", path: "/lenders/delta/switch", body: { enabled: "x" } },
  { method: "GET", path: "/consultations?nope=1" },
];

describe("backoffice session", () => {
  it("logs in with the configured credentials", async () => {
    const response = await postLogin(USERNAME, PASSWORD);
    expect(response.status).toBe(204);
    const setCookie = response.headers
      .getSetCookie()
      .find((line) => line.startsWith("bo_session="));
    expect(setCookie).toBeDefined();
    const attributes = (setCookie ?? "").split(";").map((part) => part.trim());
    expect(attributes).toContain("HttpOnly");
    expect(attributes).toContain("SameSite=Lax");
    expect(attributes).toContain("Max-Age=28800");

    const current = await backofficeFetch("/session", { cookie: sessionCookieOf(response) });
    expect(current.status).toBe(200);
    expect(await current.json()).toEqual({ username: USERNAME });
  });

  it("refuses a wrong password without a session", async () => {
    const response = await postLogin(USERNAME, `${PASSWORD}-errada`);
    expect(response.status).toBe(401);
    expect((await readProblem(response)).code).toBe("INVALID_CREDENTIALS");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("refuses every route without a valid session", async () => {
    const valid = await login();
    // Same signed cookie with a later expiry: the signature no longer matches.
    const tampered = valid.replace(/%7C\d+/, "%7C9999999999");
    expect(tampered).not.toBe(valid);
    const expired = await signedSessionCookie(`${USERNAME}|${Math.floor(Date.now() / 1000) - 60}`);
    const cases: ReadonlyArray<{ name: string; cookie?: string }> = [
      { name: "missing" },
      { name: "tampered", cookie: tampered },
      { name: "expired", cookie: expired },
    ];

    const outcomes: string[] = [];
    for (const route of GUARDED_ROUTES) {
      for (const { name, cookie } of cases) {
        const response = await backofficeFetch(route.path, {
          method: route.method,
          cookie,
          body: route.body,
        });
        const code = response.status === 401 ? (await readProblem(response)).code : "";
        outcomes.push(`${route.method} ${route.path} ${name}: ${response.status} ${code}`);
      }
    }
    expect(outcomes).toEqual(
      GUARDED_ROUTES.flatMap((route) =>
        cases.map(({ name }) => `${route.method} ${route.path} ${name}: 401 UNAUTHENTICATED`),
      ),
    );

    // The same table with the valid session is never refused (the routes exist and are guarded only).
    for (const route of GUARDED_ROUTES.filter((r) => r.method === "GET")) {
      const response = await backofficeFetch(route.path, { cookie: valid });
      expect([route.path, response.status]).not.toEqual([route.path, 401]);
    }
  });

  it("logs out", async () => {
    // A minimal cookie jar: Set-Cookie with Max-Age=0 removes the cookie.
    const jar = new Map<string, string>();
    const store = (response: Response) => {
      for (const line of response.headers.getSetCookie()) {
        const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
        const name = pair.slice(0, pair.indexOf("="));
        if (attributes.includes("Max-Age=0")) jar.delete(name);
        else jar.set(name, pair);
      }
    };
    const cookieHeader = () => [...jar.values()].join("; ") || undefined;

    store(await postLogin(USERNAME, PASSWORD));
    expect((await backofficeFetch("/session", { cookie: cookieHeader() })).status).toBe(200);

    const logout = await backofficeFetch("/session", { method: "DELETE", cookie: cookieHeader() });
    expect(logout.status).toBe(204);
    const cleared = logout.headers.getSetCookie().find((line) => line.startsWith("bo_session="));
    expect(cleared?.split(";").map((part) => part.trim())).toContain("Max-Age=0");
    store(logout);

    const after = await backofficeFetch("/session", { cookie: cookieHeader() });
    expect(after.status).toBe(401);
    expect((await readProblem(after)).code).toBe("UNAUTHENTICATED");
  });
});
