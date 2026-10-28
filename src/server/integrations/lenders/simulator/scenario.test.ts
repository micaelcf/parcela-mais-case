import { describe, expect, it } from "vite-plus/test";

import { scenarioBehaviour } from "./scenario";

describe("simulator scenarios", () => {
  it("latency ranges follow the PDF", () => {
    const latency = (...args: Parameters<typeof scenarioBehaviour>) =>
      scenarioBehaviour(...args).latency;

    expect(latency("ALFA", "NORMAL")).toEqual({ minMs: 500, maxMs: 1_500 });
    expect(latency("BETA", "NORMAL")).toEqual({ minMs: 2_000, maxMs: 5_000 });
    expect(latency("GAMA", "NORMAL")).toEqual({ minMs: 1_000, maxMs: 3_000 });
    expect(latency("DELTA", "NORMAL")).toEqual({ minMs: 4_000, maxMs: 15_000 });
    expect(latency("DELTA", "ALL_APPROVE")).toEqual({ minMs: 4_000, maxMs: 8_000 });
    expect(latency("DELTA", "DELTA_FAILS")).toEqual({ minMs: 4_000, maxMs: 8_000 });
    expect(latency("DELTA", "NONE_APPROVE")).toEqual({ minMs: 4_000, maxMs: 8_000 });
    expect(latency("DELTA", "DELTA_TIMES_OUT")).toEqual({ minMs: 12_000, maxMs: 15_000 });
  });
});
