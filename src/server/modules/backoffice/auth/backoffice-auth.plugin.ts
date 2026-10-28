import { Elysia, InvalidCookie } from "elysia";

import { env } from "#/server/infra/env/server-env";
import { DomainError } from "#/server/lib/errors/domain-error";

import { type BackofficeSession, backofficeSessionService } from "./backoffice-session.service";

export const SESSION_COOKIE = "bo_session";

/**
 * Cookie signing for the root app (`new Elysia({ cookie })`): Elysia reads signing only from the
 * root instance, so a prefixed plugin can't declare it. The root uses it to sign `bo_session` on
 * login; {@link sessionReader} uses it to verify.
 */
export const backofficeCookieConfig = {
  secrets: env.BACKOFFICE_SESSION_SECRET,
  sign: [SESSION_COOKIE],
};

/** Attributes of every `bo_session` Set-Cookie (login and logout must agree on the path). */
export const sessionCookieAttributes = {
  path: "/api/backoffice",
  httpOnly: true,
  sameSite: "lax",
  secure: env.NODE_ENV === "production",
} as const;

const unauthenticated = () =>
  new DomainError("UNAUTHENTICATED", "Sessão ausente, inválida ou expirada. Faça login novamente.");

/**
 * Elysia builds the cookie jar only after validation, so the guard can't read `cookie` in the
 * hooks that run before it. This private instance, with the same cookie config, lets Elysia's own
 * signed-cookie verification run on the request's `Cookie` header: it answers the verified
 * `bo_session` value, or nothing when the cookie is absent, unsigned or tampered (`InvalidCookie`).
 */
const sessionReader = new Elysia({ cookie: backofficeCookieConfig }).get("/", ({ cookie }) => {
  try {
    const value: unknown = cookie[SESSION_COOKIE].value;
    return typeof value === "string" ? value : "";
  } catch (error) {
    if (error instanceof InvalidCookie) return "";
    throw error;
  }
});

/** Each request's session, verified once (null = refused) and shared by the hooks below. */
const sessions = new WeakMap<Request, Promise<BackofficeSession | null>>();

function sessionOf(request: Request): Promise<BackofficeSession | null> {
  let session = sessions.get(request);
  if (!session) {
    const headers: Record<string, string> = {};
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) headers.cookie = cookieHeader;
    session = sessionReader
      .handle(new Request("http://localhost/", { headers }))
      .then((response) => response.text())
      .then((value) => backofficeSessionService.read(value));
    sessions.set(request, session);
  }
  return session;
}

/**
 * Guards every route registered after it in the parent instance: a missing, unsigned, tampered
 * or expired `bo_session` → 401 `UNAUTHENTICATED`, decided before the body is read and before
 * validation (RF-602: an unauthenticated caller never learns a schema). Elysia wraps anything
 * thrown in `parse` as a ParseError, so `parse` only skips reading a refused request's body and
 * `transform` (every route, still pre-validation) throws the 401, as the throttle plugin does.
 * `derive` then hands handlers the `operator`.
 */
export const backofficeAuthPlugin = new Elysia({ name: "backoffice-auth" })
  .onParse("plugin", async ({ request }) => {
    if (!(await sessionOf(request))) return {};
  })
  .onTransform("plugin", async ({ request }) => {
    if (!(await sessionOf(request))) throw unauthenticated();
  })
  .derive("plugin", async ({ request }) => {
    const session = await sessionOf(request);
    if (!session) throw unauthenticated();
    return { operator: { username: session.username } };
  });
