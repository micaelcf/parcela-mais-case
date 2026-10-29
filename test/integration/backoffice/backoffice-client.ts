import { Elysia } from "elysia";
import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";

import { appFetch } from "../setup/app-fetch";

/**
 * Drives the backoffice API through the real app (`app.handle`) with the project's test
 * credentials (`vite.config.ts` testEnv: operador / parcela123).
 */

export const BACKOFFICE = "http://localhost/api/backoffice";
export const USERNAME = "operador";
export const PASSWORD = "parcela123";

/** `name=value` of the `bo_session` Set-Cookie (throws when absent). */
export function sessionCookieOf(response: Response): string {
  const header = response.headers.getSetCookie().find((line) => line.startsWith("bo_session="));
  if (!header) throw new Error(`no bo_session Set-Cookie (status ${response.status})`);
  return header.split(";")[0] ?? "";
}

export function postLogin(username: string, password: string): Promise<Response> {
  return appFetch(`${BACKOFFICE}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

/** Logs in with the configured credentials; the `bo_session=<signed value>` cookie pair. */
export async function login(): Promise<string> {
  const response = await postLogin(USERNAME, PASSWORD);
  if (response.status !== 204) throw new Error(`login answered ${response.status}`);
  return sessionCookieOf(response);
}

/** A backoffice request; `cookie` is sent as the Cookie header, `body` as JSON. */
export function backofficeFetch(
  path: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return appFetch(`${BACKOFFICE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

/** The 200 JSON body of `response`, checked against the endpoint's DTO schema. */
export async function readOk<Schema extends TSchema>(response: Response, schema: Schema) {
  const text = await response.text();
  if (response.status !== 200) throw new Error(`expected 200, got ${response.status}: ${text}`);
  return Compile(schema).Parse(JSON.parse(text));
}

/** GET `path` with `cookie` and parse the 200 body against `schema`. */
export async function getOk<Schema extends TSchema>(path: string, cookie: string, schema: Schema) {
  return readOk(await backofficeFetch(path, { cookie }), schema);
}

/**
 * A `bo_session` cookie carrying `value`, signed by Elysia with the configured secret (the same
 * signing the app uses), so tests can present a genuinely signed but expired session.
 */
export async function signedSessionCookie(value: string): Promise<string> {
  const secret = process.env.BACKOFFICE_SESSION_SECRET;
  if (!secret) throw new Error("BACKOFFICE_SESSION_SECRET is not set");
  const signer = new Elysia({ cookie: { secrets: secret, sign: ["bo_session"] } }).get(
    "/",
    ({ cookie, set }) => {
      cookie.bo_session.set({ value });
      set.status = 204;
    },
  );
  return sessionCookieOf(await signer.handle(new Request("http://localhost/")));
}
