import { Elysia, NotFound, StatusMap, ValidationError } from "elysia";

import { clientIp } from "#/server/infra/http/client-ip";
import { DomainError, type ErrorCode } from "#/server/lib/errors/domain-error";
import { logger } from "#/server/lib/log/logger";

import type { ThrottleRoute } from "./throttle.repository";
import { throttleService } from "./throttle.service";

/** The `request_throttle` row of each counted request, until its outcome is written. */
const counted = new WeakMap<Request, string>();

/** The `code` the errors plugin answers with for `error` (null when the request succeeded). */
function errorCodeOf(error: unknown): ErrorCode | null {
  if (error === undefined) return null;
  if (error instanceof DomainError) return error.code;
  if (error instanceof ValidationError) return "VALIDATION";
  if (error instanceof NotFound) return "NOT_FOUND";
  return "INTERNAL";
}

function statusCodeOf(status: number | keyof typeof StatusMap | undefined): number {
  if (typeof status === "number") return status;
  return status === undefined ? 200 : StatusMap[status];
}

/**
 * Per-IP guard (`boundaries.md` § Throttle), applied per route with `{ throttle: "<route>" }`.
 * `transform` runs before body validation, so invalid requests are counted too; over the cap the
 * request fails with 429 `IP_LIMIT`. After the response, the row gets its status and error code.
 */
export const throttlePlugin = new Elysia({ name: "throttle" }).macro({
  throttle: (route: ThrottleRoute) => ({
    async transform({ request }) {
      const { requestId, rejection } = await throttleService.admit(
        clientIp(request.headers),
        route,
      );
      counted.set(request, requestId);
      if (rejection) throw rejection;
    },
    async afterResponse(context) {
      const requestId = counted.get(context.request);
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
