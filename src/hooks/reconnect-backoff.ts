const FIRST_DELAY_MS = 500;
const MAX_DELAY_MS = 4_000;

export type ReconnectBackoff = {
  /** The delay before the next reconnect attempt: 500, 1000, 2000, 4000, 4000… ms. */
  next(): number;
  /** A snapshot arrived: the connection is healthy again, so the next drop starts over at 500 ms. */
  reset(): void;
};

export function createReconnectBackoff(): ReconnectBackoff {
  let delay = FIRST_DELAY_MS;
  return {
    next() {
      const current = delay;
      delay = Math.min(delay * 2, MAX_DELAY_MS);
      return current;
    },
    reset() {
      delay = FIRST_DELAY_MS;
    },
  };
}
