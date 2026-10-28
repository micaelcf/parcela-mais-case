import { Compile } from "typebox/compile";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { ConsultationPublicViewSchema } from "#/server/modules/consultation/consultation.dto";
import { lenderAttemptRepository } from "#/server/modules/lender/lender-attempt.repository";
import { createWorker } from "#/server/worker";

import { closeTestApp, testLenderRegistry } from "../setup/app-fetch";
import {
  choose,
  createConsultation,
  readEvents,
  readView,
  type StreamEvent,
  waitFor,
} from "./consultation-client";

const worker = createWorker({ lenderRegistry: testLenderRegistry });
beforeAll(() => worker.start());
afterAll(async () => {
  await worker.stop();
  await closeTestApp();
});

/** Opens a stream, returns its first event and drops the connection (a client going away). */
async function firstEvent(id: string): Promise<StreamEvent | undefined> {
  const controller = new AbortController();
  const { events } = await readEvents(id, {
    signal: controller.signal,
    onEvent: () => controller.abort(),
  });
  return events[0];
}

const View = Compile(ConsultationPublicViewSchema);

/** Every `snapshot` event's data, validated as a ConsultationPublicView. */
const snapshotsOf = (events: StreamEvent[]) =>
  events.filter((event) => event.event === "snapshot").map((event) => View.Parse(event.data));

describe("GET /consultations/:id/events", () => {
  it("starts every connection with a full snapshot", async () => {
    // Delta never answers in time: once the other three settle, the state holds until the deadline.
    const id = await createConsultation({}, "DELTA_TIMES_OUT");
    await waitFor(
      () => lenderAttemptRepository.listByConsultation(id),
      (rows) => rows.filter((row) => row.status !== "PENDING").length === 3,
    );

    const first = await firstEvent(id);
    expect(first?.event).toBe("snapshot");
    expect(first?.data).toEqual(await readView(id));

    // Reconnect mid-consultation: a fresh connection starts over with the current snapshot.
    const reconnected = await firstEvent(id);
    expect(reconnected?.event).toBe("snapshot");
    const now = await readView(id);
    expect(now.quoteStatus).toBe("QUOTING");
    expect(reconnected?.data).toEqual(now);
  });

  it("pushes a choice at once whatever letter case the stream and the choice use", async () => {
    // Without a notification the stream only re-reads every 2 s; a pushed update lands well before.
    for (const [streamCase, chooseCase] of [
      ["lower", "upper"],
      ["upper", "lower"],
    ] as const) {
      const id = await createConsultation({}, "DELTA_TIMES_OUT");
      const quoting = await waitFor(
        () => readView(id),
        (view) => view.attempts.filter((attempt) => attempt.status !== "PENDING").length === 3,
      );
      const offerId = quoting.offers[0]?.id ?? "";
      const caseOf = (value: string, kind: "lower" | "upper") =>
        kind === "upper" ? value.toUpperCase() : value;

      const controller = new AbortController();
      let choseAt = 0;
      let landedAfterMs = Number.POSITIVE_INFINITY;
      await readEvents(caseOf(id, streamCase), {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.event !== "snapshot") return;
          const view = View.Parse(event.data);
          if (choseAt === 0) {
            choseAt = Date.now();
            void choose(caseOf(id, chooseCase), offerId);
          } else if (view.choice?.offerId === offerId) {
            landedAfterMs = Date.now() - choseAt;
            controller.abort();
          }
        },
      });

      expect([streamCase, chooseCase, landedAfterMs < 1_000]).toEqual([
        streamCase,
        chooseCase,
        true,
      ]);
    }
  });

  it("streams per-lender updates", async () => {
    const id = await createConsultation({}, "NORMAL");

    const { events } = await readEvents(id);

    const partial = snapshotsOf(events).find((view) => {
      const byLender = Object.fromEntries(view.attempts.map((a) => [a.lender, a.status]));
      return byLender.ALFA !== "PENDING" && byLender.DELTA === "PENDING";
    });
    expect(partial).toBeDefined();
  });

  it("closes after the settled snapshot", async () => {
    const id = await createConsultation({}, "NORMAL");

    const { events } = await readEvents(id);

    const snapshots = snapshotsOf(events);
    const settled = snapshots.filter((view) => view.quoteStatus === "SETTLED");
    expect(settled).toHaveLength(1);
    expect(events.at(-1)?.event).toBe("snapshot");
    expect(snapshots.at(-1)?.quoteStatus).toBe("SETTLED");
  });
});
