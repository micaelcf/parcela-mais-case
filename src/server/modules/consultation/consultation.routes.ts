import { Elysia, sse } from "elysia";

import {
  type ConsultationSubscription,
  consultationEvents,
} from "#/server/infra/realtime/consultation-events";

import {
  ChooseRequestSchema,
  type ConsultationPublicView,
  IdempotencyHeadersSchema,
  SignupRequestSchema,
} from "./consultation.dto";
import { consultationService } from "./consultation.service";

/** Re-read cadence when no notification arrives (lazy finalize past the deadline, lost NOTIFYs). */
const REREAD_MS = 2_000;
const PING_MS = 15_000;

/** Waits for the next notification, `ms`, or the client going away, whichever comes first. */
async function waitForUpdate(
  subscription: ConsultationSubscription,
  ms: number,
  clientGone: AbortSignal,
): Promise<void> {
  const signal = AbortSignal.any([clientGone, AbortSignal.timeout(ms)]);
  await subscription.next(signal);
}

/** Public consultation API: create, read, live events, choose (`api.md` § Public). */
export const consultationRoutes = new Elysia({ name: "consultation" })
  .post(
    "/consultations",
    { body: SignupRequestSchema, headers: IdempotencyHeadersSchema },
    async ({ body, headers, set }) => {
      const created = await consultationService.create(body, headers["idempotency-key"]);
      set.status = 202;
      return created;
    },
  )
  .get("/consultations/:id", ({ params }) => consultationService.view(params.id))
  .get("/consultations/:id/events", async function* ({ params, request }) {
    const subscription = await consultationEvents.subscribe(params.id);
    try {
      let view: ConsultationPublicView = await consultationService.view(params.id);
      let sent = JSON.stringify(view);
      yield sse({ event: "snapshot", data: view });
      let nextPingAt = Date.now() + PING_MS;
      while (view.quoteStatus !== "SETTLED") {
        await waitForUpdate(
          subscription,
          Math.max(0, Math.min(REREAD_MS, nextPingAt - Date.now())),
          request.signal,
        );
        if (request.signal.aborted) return;
        view = await consultationService.view(params.id);
        const serialized = JSON.stringify(view);
        if (serialized !== sent) {
          nextPingAt = Date.now() + PING_MS;
          sent = serialized;
          yield sse({ event: "snapshot", data: view });
          continue;
        }
        if (Date.now() >= nextPingAt) {
          nextPingAt = Date.now() + PING_MS;
          yield sse({ event: "ping", data: null });
        }
      }
    } finally {
      subscription.close();
    }
  })
  .post("/consultations/:id/choice", { body: ChooseRequestSchema }, ({ params, body }) =>
    consultationService.choose(params.id, body.offerId),
  );
