import { randomUUID } from "node:crypto";

import { expect, test } from "./support/fixtures";
import { newPatient } from "./support/patient";

/** The stack's per-IP cap on create requests (`RATE_LIMIT_IP_MAX`, default 30). */
const IP_MAX = Number(process.env.RATE_LIMIT_IP_MAX ?? 30);

test.describe("behind Caddy", () => {
  test("ignores a forged X-Forwarded-For", async ({ request, baseURL }) => {
    const health = await request.get("/api/health");
    // Caddy marks proxied responses with `Via: 1.1 Caddy` (it sets `Server` only on its own).
    const proxied = /caddy/i.test(`${health.headers().via ?? ""} ${health.headers().server ?? ""}`);
    test.skip(
      !proxied,
      `${baseURL} isn't the Caddy proxy (no "Via: … Caddy"): run with E2E_BASE_URL=http://localhost:8080 against vp run up --prod`,
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
        data: {
          fullName: patient.fullName,
          cpf: patient.cpf,
          birthdate: patient.birthdate,
          phone: patient.phone,
          monthlyIncomeCents: patient.monthlyIncomeCents,
          treatmentAmountCents: patient.treatmentAmountCents,
        },
      });
      last = { status: response.status(), body: await response.json() };
    }

    expect(last?.status).toBe(429);
    expect(last?.body).toMatchObject({ code: "IP_LIMIT" });
  });
});
