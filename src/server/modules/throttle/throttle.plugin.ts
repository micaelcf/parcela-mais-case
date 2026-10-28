import { Elysia, NotFound, ParseError, StatusMap, ValidationError } from "elysia";

import { clientIp } from "#/server/infra/http/client-ip";
import { isUnsupportedMediaType } from "#/server/infra/http/errors.plugin";
import { DomainError, type ErrorCode } from "#/server/lib/errors/domain-error";
import { logger } from "#/server/lib/log/logger";

import type { ThrottleRoute } from "./throttle.repository";
import { throttleService } from "./throttle.service";

/** Each counted request's `request_throttle` row and verdict, until its outcome is written. */
const counted = new WeakMap<Request, { requestId: string; rejection: DomainError | null }>();

/** The `code` the errors plugin answers with for `error` (null when the request succeeded). */
function errorCodeOf(error: unknown): ErrorCode | null {
  if (error === undefined) return null;
  if (error instanceof DomainError) return error.code;
  if (
    error instanceof ValidationError ||
    error instanceof ParseError ||
    isUnsupportedMediaType(error)
  ) {
    return "VALIDATION";
  }
  if (error instanceof NotFound) return "NOT_FOUND";
  return "INTERNAL";
}

function statusCodeOf(status: number | keyof typeof StatusMap | undefined): number {
  if (typeof status === "number") return status;
  return status === undefined ? 200 : StatusMap[status];
}

/**
 * Per-IP guard (`boundaries.md` § Throttle), applied per route with `{ throttle: "<route>" }`.
 * `parse` runs before the body is read, so malformed and invalid requests are counted too. Elysia
 * wraps anything thrown in `parse` as a ParseError, so over the cap `parse` skips reading the
 * body (an empty one) and `transform`, still before validation, fails with 429 `IP_LIMIT`.
 * After the response, the row gets its status and error code.
 */
export const throttlePlugin = new Elysia({ name: "throttle" }).macro({
  throttle: (route: ThrottleRoute) => ({
    async parse({ request }) {
      const admission = await throttleService.admit(clientIp(request.headers), route);
      counted.set(request, admission);
      if (admission.rejection) return {};
    },
    transform({ request }) {
      const rejection = counted.get(request)?.rejection;
      if (rejection) throw rejection;
    },
    async afterResponse(context) {
      const requestId = counted.get(context.request)?.requestId;
      if (!requestId) return;
      counted.delete(context.request);
      const error: unknown = "error" in context ? context.error : undefined;
      try {
        await throttleService.recordOutcome(
          requestId,
          statusCodeOf(context.set.status),
          errorCodeOf(error),
        );
      } catch (failure) {
        logger.error("throttle.outcome_not_recorded", {
          route,
          message: failure instanceof Error ? failure.message : String(failure),
        });
      }
    },
  }),
});
