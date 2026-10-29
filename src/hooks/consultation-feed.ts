import type { ConsultationPublicView } from "#/server/modules/consultation/consultation.dto";

import { createReconnectBackoff } from "./reconnect-backoff";

/** How the view is arriving: the live SSE stream, or GET reads while the stream is unusable. */
export type FeedTransport = "stream" | "polling";

export type ConsultationFeedSource = {
  /** One live connection (SSE): every snapshot until the server closes it. */
  stream(signal: AbortSignal): AsyncIterable<ConsultationPublicView>;
  /** One read of the view (`GET /consultations/:id`), null when it doesn't exist. */
  read(): Promise<ConsultationPublicView | null>;
};

export type ConsultationFeedListener = {
  view(view: ConsultationPublicView): void;
  /** Called on each switch; the feed starts on the stream. */
  transport(transport: FeedTransport): void;
};

export const FEED_TIMING = {
  /** The server sends a snapshot as soon as a connection opens: silence this long means a stall. */
  firstSnapshotMs: 3_000,
  /** Consecutive connections that fail before the feed polls. */
  failuresBeforePolling: 2,
  pollEveryMs: 2_000,
  /** The server settles a consultation at its deadline; a view still open this long after it means
   * the stream stopped delivering, so the feed polls (a read also settles one past its deadline). */
  deadlineGraceMs: 2_000,
};

/**
 * Keeps a consultation view current until it settles: the SSE stream first, reconnecting with
 * backoff, and polling the read endpoint while the stream is unusable (connections failing or
 * stalling, or no settled view past the deadline). Returns a function that stops it.
 */
export function startConsultationFeed(
  initial: ConsultationPublicView,
  source: ConsultationFeedSource,
  on: ConsultationFeedListener,
): () => void {
  if (initial.quoteStatus === "SETTLED") return () => {};

  const backoff = createReconnectBackoff();
  let stopped = false;
  let polling = false;
  let pastDeadline = false;
  let failures = 0;
  let connection: AbortController | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  const deadlineTimer = setTimeout(
    () => {
      pastDeadline = true;
      startPolling();
    },
    Math.max(0, Date.parse(initial.deadlineAt) + FEED_TIMING.deadlineGraceMs - Date.now()),
  );

  function stop() {
    stopped = true;
    connection?.abort();
    clearTimeout(reconnectTimer);
    clearTimeout(pollTimer);
    clearTimeout(deadlineTimer);
  }

  function deliver(view: ConsultationPublicView) {
    on.view(view);
    if (view.quoteStatus === "SETTLED") stop();
  }

  function startPolling() {
    if (stopped || polling) return;
    polling = true;
    on.transport("polling");
    void poll();
  }

  function stopPolling() {
    if (!polling || pastDeadline) return;
    polling = false;
    clearTimeout(pollTimer);
    on.transport("stream");
  }

  async function poll() {
    let view: ConsultationPublicView | null = null;
    try {
      view = await source.read();
    } catch {
      // Offline or a server error: the next poll tries again.
    }
    // The stream may have recovered (or the feed stopped) while this read was in flight.
    if (stopped || !polling) return;
    if (view) deliver(view);
    if (!stopped) pollTimer = setTimeout(() => void poll(), FEED_TIMING.pollEveryMs);
  }

  async function connect() {
    const current = new AbortController();
    connection = current;
    let received = false;
    const stallTimer = setTimeout(() => current.abort(), FEED_TIMING.firstSnapshotMs);
    try {
      for await (const view of source.stream(current.signal)) {
        received = true;
        clearTimeout(stallTimer);
        failures = 0;
        backoff.reset();
        stopPolling();
        deliver(view);
        if (stopped) return;
      }
    } catch {
      // Refused, dropped or stalled: reconnect below.
    }
    clearTimeout(stallTimer);
    if (stopped) return;
    if (!received) {
      failures += 1;
      if (failures >= FEED_TIMING.failuresBeforePolling) startPolling();
    }
    reconnectTimer = setTimeout(() => void connect(), backoff.next());
  }

  void connect();
  return stop;
}
