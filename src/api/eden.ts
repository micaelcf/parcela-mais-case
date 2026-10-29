import { treaty } from "@elysia/eden";
import Type, { type Static } from "typebox";
import { Value } from "typebox/value";

import type { App } from "#/server/app";

/**
 * The browser's typed client for `/api`. Route modules are also evaluated by the server bundle
 * while it renders the static shell (no SSR), so the origin is read only where `location` exists;
 * the client is never called there.
 */
export const api = treaty<App>(globalThis.location?.origin ?? "http://localhost", {
  parseDate: false,
}).api;

/** RFC 9457 body every API error carries (`api.md` § Errors). */
export const ProblemSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Integer(),
  code: Type.String(),
  detail: Type.Optional(Type.String()),
  fields: Type.Optional(Type.Array(Type.Object({ path: Type.String(), message: Type.String() }))),
});
export type Problem = Static<typeof ProblemSchema>;

/** A mutation outcome: the success body, or the problem the API (or the network) reported. */
export type Result<T> = { ok: true; value: T } | { ok: false; problem: Problem };

const NETWORK_PROBLEM: Problem = {
  type: "about:blank",
  title: "Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.",
  status: 0,
  code: "NETWORK",
};

/**
 * The problem body of an Eden error. A body that isn't one (a proxy's 502, the dev server's 500)
 * gets the generic connection problem with the response's own status.
 */
export function toProblem(error: { status: unknown; value: unknown } | null | undefined): Problem {
  if (error && Value.Check(ProblemSchema, error.value)) return error.value;
  return typeof error?.status === "number"
    ? { ...NETWORK_PROBLEM, status: error.status }
    : NETWORK_PROBLEM;
}

/**
 * A failed read a page can't do without, thrown from a loader to the route's error page; it keeps
 * the problem, so the page shows its status (0: the server couldn't be reached).
 */
export class ApiError extends Error {
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.title);
    this.name = "ApiError";
    this.problem = problem;
  }
}

/** Runs an Eden call, mapping thrown network failures and error responses to a `Result`. */
export async function toResult<T>(
  call: () => Promise<
    { data: T; error: null } | { data: null; error: { status: unknown; value: unknown } }
  >,
): Promise<Result<T>> {
  try {
    const response = await call();
    if (response.error) return { ok: false, problem: toProblem(response.error) };
    return { ok: true, value: response.data };
  } catch {
    return { ok: false, problem: NETWORK_PROBLEM };
  }
}
