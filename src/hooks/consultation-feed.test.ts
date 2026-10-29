import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ConsultationPublicView } from "#/server/modules/consultation/consultation.dto";

import { type FeedTransport, startConsultationFeed } from "./consultation-feed";

const CREATED_AT = new Date("2026-10-28T12:00:00.000Z");

function view(overrides: Partial<ConsultationPublicView> = {}): ConsultationPublicView {
  return {
    id: "consulta-1",
    journeyStatus: "QUOTING",
    quoteStatus: "QUOTING",
    createdAt: CREATED_AT.toISOString(),
    deadlineAt: new Date(CREATED_AT.getTime() + 10_000).toISOString(),
    settledAt: null,
    patientFirstName: "Maria",
    treatmentAmountCents: 1_000_000,
    simulationScenario: "NORMAL",
    attempts: [],
    offers: [],
    choice: null,
    suggestion: null,
    ...overrides,
  };
}

const settled = view({ quoteStatus: "SETTLED", journeyStatus: "OFFERS" });

type Connection = { send(snapshot: ConsultationPublicView): void; drop(): void };

/**
 * A server double: each `stream` call is one SSE connection the test drives, or an immediate
 * failure while `refuse` is on; `read` (GET /consultations/:id) answers with `readResult`, which
 * may be a promise the test settles later.
 */
function fakeServer() {
  const server = {
    refuse: false,
    readResult: view() as ConsultationPublicView | Error | Promise<ConsultationPublicView>,
    reads: 0,
    opened: 0,
    connections: [] as Connection[],
    source: {
      stream: async function* (signal: AbortSignal) {
        server.opened += 1;
        if (server.refuse) throw new Error("503 Service Unavailable");
        const queue: Array<ConsultationPublicView | "drop"> = [];
        let wake = () => {};
        server.connections.push({
          send: (snapshot) => (queue.push(snapshot), wake()),
          drop: () => (queue.push("drop"), wake()),
        });
        signal.addEventListener("abort", () => wake());
        while (true) {
          if (signal.aborted) throw new DOMException("aborted", "AbortError");
          const next = queue.shift();
          if (next === "drop") throw new Error("connection dropped");
          if (next) {
            yield next;
            continue;
          }
          const { promise, resolve } = Promise.withResolvers<void>();
          wake = resolve;
          await promise;
        }
      },
      read: async () => {
        server.reads += 1;
        if (server.readResult instanceof Error) throw server.readResult;
        return server.readResult;
      },
    },
  };
  return server;
}

function listener() {
  const seen = { views: [] as ConsultationPublicView[], transports: [] as FeedTransport[] };
  return {
    seen,
    on: {
      view: (snapshot: ConsultationPublicView) => seen.views.push(snapshot),
      transport: (transport: FeedTransport) => seen.transports.push(transport),
    },
  };
}

describe("startConsultationFeed", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: CREATED_AT });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("follows the stream until the consultation settles, without polling", async () => {
    const server = fakeServer();
    const { seen, on } = listener();
    startConsultationFeed(view(), server.source, on);
    await vi.advanceTimersByTimeAsync(0);

    const progress = view({ journeyStatus: "OFFERS" });
    server.connections[0]?.send(progress);
    await vi.advanceTimersByTimeAsync(1_000);
    server.connections[0]?.send(settled);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(seen.views).toEqual([progress, settled]);
    expect(seen.transports).toEqual([]);
    expect(server.reads).toBe(0);
    expect(server.connections).toHaveLength(1);
  });

  it("polls every 2 s after two refused connections, until a read returns the settled view", async () => {
    const server = fakeServer();
    server.refuse = true;
    const { seen, on } = listener();
    startConsultationFeed(view(), server.source, on);

    // Refused at 0 ms and again at 500 ms (backoff): the second failure starts polling.
    await vi.advanceTimersByTimeAsync(499);
    expect(seen.transports).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.transports).toEqual(["polling"]);
    expect(server.reads).toBe(1);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(server.reads).toBe(3);

    server.readResult = settled;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen.views.at(-1)).toEqual(settled);

    const { reads, opened } = server;
    await vi.advanceTimersByTimeAsync(60_000);
    expect({ reads: server.reads, opened: server.opened }).toEqual({ reads, opened });
  });

  it("goes back to the stream once it delivers, dropping a read still in flight", async () => {
    const server = fakeServer();
    server.refuse = true;
    const { seen, on } = listener();
    startConsultationFeed(view(), server.source, on);
    await vi.advanceTimersByTimeAsync(500);
    expect(seen.transports).toEqual(["polling"]);

    // The 2 500 ms read hangs; the stream accepts the 3 500 ms reconnect and sends a newer view.
    const slowRead = Promise.withResolvers<ConsultationPublicView>();
    server.readResult = slowRead.promise;
    server.refuse = false;
    await vi.advanceTimersByTimeAsync(3_000);
    const fresh = view({ journeyStatus: "OFFERS" });
    server.connections[0]?.send(fresh);
    await vi.advanceTimersByTimeAsync(0);
    slowRead.resolve(view({ patientFirstName: "Stale" }));
    await vi.advanceTimersByTimeAsync(0);

    expect(seen.transports).toEqual(["polling", "stream"]);
    expect(seen.views.at(-1)).toEqual(fresh);
    const reads = server.reads;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(server.reads).toBe(reads);
  });

  it("counts a connection that sends nothing for 3 s as failed", async () => {
    const server = fakeServer();
    const { seen, on } = listener();
    startConsultationFeed(view(), server.source, on);

    // Stalled at 3 000 ms, reconnected at 3 500 ms, stalled again at 6 500 ms.
    await vi.advanceTimersByTimeAsync(6_499);
    expect(seen.transports).toEqual([]);
    expect(server.opened).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.transports).toEqual(["polling"]);
    expect(server.reads).toBe(1);
  });

  it("polls from 2 s past the deadline when the stream is open but quiet", async () => {
    const server = fakeServer();
    const { seen, on } = listener();
    startConsultationFeed(view(), server.source, on);
    await vi.advanceTimersByTimeAsync(0);
    server.connections[0]?.send(view());

    // Deadline at 10 s: a quiet open stream is normal until then.
    await vi.advanceTimersByTimeAsync(11_999);
    expect(server.reads).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.transports).toEqual(["polling"]);

    // Past the deadline an unsettled snapshot doesn't end the polling; the settled read does.
    server.connections[0]?.send(view({ journeyStatus: "OFFERS" }));
    server.readResult = settled;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen.transports).toEqual(["polling"]);
    expect(seen.views.at(-1)).toEqual(settled);
  });

  it("reads and reconnects no more once stopped", async () => {
    const server = fakeServer();
    server.refuse = true;
    const { on } = listener();
    const stop = startConsultationFeed(view(), server.source, on);
    await vi.advanceTimersByTimeAsync(500);
    expect(server.reads).toBe(1);

    stop();
    const opened = server.opened;
    await vi.advanceTimersByTimeAsync(60_000);
    expect({ reads: server.reads, opened: server.opened }).toEqual({ reads: 1, opened });
  });

  it("opens nothing for a consultation that has already settled", async () => {
    const server = fakeServer();
    const { seen, on } = listener();
    startConsultationFeed(settled, server.source, on);
    await vi.advanceTimersByTimeAsync(60_000);
    expect({ opened: server.opened, reads: server.reads, views: seen.views }).toEqual({
      opened: 0,
      reads: 0,
      views: [],
    });
  });
});
