import { sql } from "drizzle-orm";
import { Client } from "pg";

import type { Tx } from "#/server/infra/db/client";
import { env } from "#/server/infra/env/server-env";
import { logger } from "#/server/lib/log/logger";

/** NOTIFY channel; the payload is the consultation id. */
export const CONSULTATION_UPDATED_CHANNEL = "consultation_updated";

const RECONNECT_MIN_MS = 250;
const RECONNECT_MAX_MS = 5_000;

/** Queues a `consultation_updated` notification; Postgres delivers it only when `tx` commits. */
export async function notifyConsultationUpdated(tx: Tx, consultationId: string): Promise<void> {
  await tx.execute(sql`select pg_notify(${CONSULTATION_UPDATED_CHANNEL}, ${consultationId})`);
}

/** One consultation's updates as seen by one subscriber. */
export type ConsultationSubscription = {
  /** Resolves on the next update (immediately if one arrived since the last call), or on `signal`. */
  next(signal: AbortSignal): Promise<void>;
  close(): void;
};

type Listener = { notify(): void };

/**
 * One dedicated LISTEN connection per process, fanned out in memory to every subscriber of a
 * consultation id. It connects on the first subscription, reconnects with backoff, and after a
 * reconnect wakes every subscriber (notifications sent while disconnected are lost).
 */
function createConsultationEvents(connectionString: string) {
  const listeners = new Map<string, Set<Listener>>();
  let client: Client | null = null;
  let connecting: Promise<void> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = RECONNECT_MIN_MS;
  let closed = false;

  const wakeAll = () => {
    for (const set of listeners.values()) for (const listener of set) listener.notify();
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect().then(wakeAll);
    }, backoffMs);
    backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
  };

  const connect = (): Promise<void> => {
    connecting ??= (async () => {
      const next = new Client({ connectionString, application_name: "parcela-realtime" });
      next.on("notification", (message) => {
        if (message.channel !== CONSULTATION_UPDATED_CHANNEL || !message.payload) return;
        for (const listener of listeners.get(message.payload) ?? []) listener.notify();
      });
      const lost = (error?: Error) => {
        if (client !== next) return;
        client = null;
        if (error) logger.warn("realtime.connection_lost", { message: error.message });
        scheduleReconnect();
      };
      next.on("error", lost);
      next.on("end", () => lost());
      try {
        await next.connect();
        await next.query(`LISTEN ${CONSULTATION_UPDATED_CHANNEL}`);
        if (closed) {
          await next.end();
          return;
        }
        client = next;
        backoffMs = RECONNECT_MIN_MS;
      } catch (error) {
        logger.warn("realtime.connect_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        next.end().catch(() => undefined);
        scheduleReconnect();
      }
    })().finally(() => {
      connecting = null;
    });
    return connecting;
  };

  return {
    /**
     * Subscribes to one consultation's updates. Resolves once LISTEN is active (or the attempt
     * failed, in which case callers rely on their polling fallback), so no commit after the
     * subscription can go unnoticed.
     */
    async subscribe(consultationId: string): Promise<ConsultationSubscription> {
      closed = false;
      let pending = false;
      let wake: (() => void) | null = null;
      const listener: Listener = {
        notify() {
          pending = true;
          wake?.();
        },
      };
      let set = listeners.get(consultationId);
      if (!set) {
        set = new Set();
        listeners.set(consultationId, set);
      }
      set.add(listener);
      if (!client) await connect();

      return {
        next(signal) {
          if (pending || signal.aborted) {
            pending = false;
            return Promise.resolve();
          }
          // `Promise.withResolvers` is ES2024; the repo targets ES2022 (tsconfig lib).
          return new Promise<void>((resolve) => {
            const done = () => {
              wake = null;
              pending = false;
              signal.removeEventListener("abort", done);
              resolve();
            };
            wake = done;
            signal.addEventListener("abort", done, { once: true });
          });
        },
        close() {
          const current = listeners.get(consultationId);
          current?.delete(listener);
          if (current?.size === 0) listeners.delete(consultationId);
          wake?.();
        },
      };
    },

    /** Drops the LISTEN connection and stops reconnecting (process shutdown, test teardown). */
    async close(): Promise<void> {
      closed = true;
      clearTimeout(reconnectTimer ?? undefined);
      reconnectTimer = null;
      await connecting;
      const current = client;
      client = null;
      await current?.end();
    },
  };
}

export const consultationEvents = createConsultationEvents(env.DATABASE_URL);
