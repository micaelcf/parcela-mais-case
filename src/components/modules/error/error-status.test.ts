import { describe, expect, it } from "vite-plus/test";

import { ApiError, toProblem } from "#/api/eden";

import { errorCopyOf, errorStatusOf } from "./error-status";

describe("errorStatusOf", () => {
  it("shows the API's status from its problem body", () => {
    const problem = {
      type: "about:blank",
      title: "Muitas consultas",
      status: 429,
      code: "RATE_LIMITED",
    };
    expect(errorStatusOf(new ApiError(toProblem({ status: 429, value: problem })))).toBe(429);
  });

  it("keeps a proxy's status when the body isn't a problem", () => {
    expect(errorStatusOf(new ApiError(toProblem({ status: 502, value: "Bad Gateway" })))).toBe(502);
  });

  it("shows 503 when the server couldn't be reached at all", () => {
    expect(errorStatusOf(new ApiError(toProblem(null)))).toBe(503);
  });

  it("shows 500 for an error that isn't an API failure", () => {
    expect(errorStatusOf(new TypeError("Cannot read properties of undefined"))).toBe(500);
  });
});

describe("errorCopyOf", () => {
  it("offers a retry for server faults and rate limits, not for a missing page", () => {
    expect([503, 500, 599, 429, 404, 418].map((status) => errorCopyOf(status).retryable)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});
