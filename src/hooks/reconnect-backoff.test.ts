import { describe, expect, it } from "vite-plus/test";

import { createReconnectBackoff } from "./reconnect-backoff";

describe("createReconnectBackoff", () => {
  it("backs off up to 4 s and resets on a snapshot", () => {
    const backoff = createReconnectBackoff();
    const delays = Array.from({ length: 5 }, () => backoff.next());

    expect(delays).toEqual([500, 1000, 2000, 4000, 4000]);

    backoff.reset();
    expect(backoff.next()).toBe(500);
    expect(backoff.next()).toBe(1000);
  });
});
