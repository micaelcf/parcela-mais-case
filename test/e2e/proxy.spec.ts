import { randomUUID } from "node:crypto";

import { expect, test } from "./support/fixtures";
import { newPatient } from "./support/patient";
import { signupBody } from "./support/signup";

/** The stack's per-IP cap on create requests (`RATE_LIMIT_IP_MAX`, default 30). */
const IP_MAX = Number(process.env.RATE_LIMIT_IP_MAX ?? 30);

test.describe("behind Caddy", () => {
  // The forged-header test spends this host's whole IP allowance, so it runs last.
  test.describe.configure({ mode: "serial" });

  // Caddyfile has `encode zstd gzip`: prove each encoding Caddy may pick still streams. The first
  // value is what Chromium sends.
  for (const acceptEncoding of ["zstd, br, gzip, deflate", "gzip", "identity"]) {
    test(`streams snapshots through Caddy without buffering (Accept-Encoding: ${acceptEncoding})`, async ({
      request,
      baseURL,
    }) => {
      const health = await request.get("/api/health");
      const proxied = /caddy/i.test(
        `${health.headers().via ?? ""} ${health.headers().server ?? ""}`,
      );
      test.skip(!proxied, `${baseURL} isn't the Caddy proxy`);

      const patient = newPatient();
      const created = await request.post("/api/consultations", {
        headers: { "Idempotency-Key": randomUUID() },
        data: signupBody(patient),
      });
      expect(created.status()).toBe(202);
      const { id } = (await created.json()) as { id: string };

      // Read the stream as it arrives and note when each snapshot lands.
      const started = Date.now();
      const arrivals: number[] = [];
      const response = await fetch(`${baseURL}/api/consultations/${id}/events`, {
        headers: { "accept-encoding": acceptEncoding },
      });
      const contentEncoding = response.headers.get("content-encoding") ?? "identity";
      test.info().annotations.push({ type: "content-encoding", description: contentEncoding });
      console.log(`Accept-Encoding: ${acceptEncoding} → Content-Encoding: ${contentEncoding}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("no stream body");
      const decoder = new TextDecoder();
      let buffered = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const events = buffered.split("\n\n");
        buffered = events.pop() ?? "";
        for (const event of events) {
          if (event.includes("event: snapshot")) arrivals.push(Date.now() - started);
        }
      }

      // Lenders answer over several seconds, so an unbuffered stream delivers the first snapshot
      // right away and later ones seconds apart; a buffering proxy would deliver them all at the end.
      expect(arrivals.length).toBeGreaterThanOrEqual(2);
      expect(arrivals[0]).toBeLessThan(1_500);
      expect(arrivals.at(-1)! - arrivals[0]!).toBeGreaterThan(1_000);
    });
  }

  test("ignores a forged X-Forwarded-For", async ({ request, baseURL }) => {
    const health = await request.get("/api/health");
    // Caddy marks proxied responses with `Via: 1.1 Caddy` (it sets `Server` only on its own).
    const proxied = /caddy/i.test(`${health.headers().via ?? ""} ${health.headers().server ?? ""}`);
    // The dev Caddy trusts the client's X-Forwarded-For on purpose (like the dev server alone), and
    // says so with `X-Parcela-Stack: dev`; only the production rule is under test here.
    const devProxy = health.headers()["x-parcela-stack"] === "dev";
    test.skip(
      !proxied || devProxy,
      `${baseURL} isn't the production proxy: run with E2E_BASE_URL=https://parcela.localhost:8443 against vp run up --prod`,
    );

    let last: { status: number; body: unknown } | null = null;
    for (let attempt = 0; attempt <= IP_MAX; attempt++) {
      const patient = newPatient();
      const response = await request.post("/api/consultations", {
        headers: {
          "Idempotency-Key": randomUUID(),
          // A different forged client address on every request: Caddy must replace it.
          "X-Forwarded-For": `203.0.${Math.floor(attempt / 250)}.${(attempt % 250) + 1}`,
        },
        data: signupBody(patient),
      });
      last = { status: response.status(), body: await response.json() };
    }

    expect(last?.status).toBe(429);
    expect(last?.body).toMatchObject({ code: "IP_LIMIT" });
  });
});
