import { app } from "#/server/app";
import { closeDb } from "#/server/infra/db/client";
import { stopBoss } from "#/server/infra/queue/boss";
import { consultationEvents } from "#/server/infra/realtime/consultation-events";
import type { FetchLike } from "#/server/integrations/lenders/lender.port";
import { createLenderRegistry } from "#/server/integrations/lenders/registry";

/** `fetch` served by the real Elysia app in-process (no port). */
export const appFetch: FetchLike = (input, init) => app.handle(new Request(input, init));

/** The four lender adapters, talking to the simulator behind the real app. */
export const testLenderRegistry = createLenderRegistry({
  baseUrl: "http://localhost/api/simulator/lenders",
  fetch: appFetch,
});

/** Stops this file's pg-boss, LISTEN client and pool so the test file exits cleanly. */
export async function closeTestApp(): Promise<void> {
  await stopBoss();
  await consultationEvents.close();
  await closeDb();
}
