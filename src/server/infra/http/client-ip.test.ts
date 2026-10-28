import { describe, expect, it } from "vite-plus/test";

import { clientIp } from "./client-ip";

describe("counted client IP", () => {
  it("reads the proxy-set address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    // Caddy writes the peer it saw first; anything after it never decides the counted IP.
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 198.51.100.9" }))).toBe(
      "203.0.113.7",
    );
    expect(clientIp(new Headers({ "x-forwarded-for": " 2001:db8::1 ,10.0.0.1" }))).toBe(
      "2001:db8::1",
    );
    expect(clientIp(new Headers())).toBe("local");
    expect(clientIp(new Headers({ "x-forwarded-for": "" }))).toBe("local");
  });
});
