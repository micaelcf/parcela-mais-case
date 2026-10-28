import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vite-plus/test";

// Must be set before any app module reads the env (dynamic imports below).
process.env.RATE_LIMIT_IP_MAX = "3";
process.env.RATE_LIMIT_IP_WINDOW_MINUTES = "60";
// One consultation per patient, so a PATIENT_LIMIT outcome takes two requests.
process.env.RATE_LIMIT_PATIENT_MAX = "1";

const { hashIp } = await import("#/server/lib/crypto/ip-hash");
const { throttlePurgeJob } = await import("#/server/modules/throttle/throttle-purge.job");
const { throttleRepository } = await import("#/server/modules/throttle/throttle.repository");
const { throttleService } = await import("#/server/modules/throttle/throttle.service");
const { closeTestApp } = await import("../setup/app-fetch");
const {
  postConsultation,
  postRequote,
  readProblem,
  signupBody,
  sleep,
  uniqueCpf,
  uniqueIp,
  waitFor,
} = await import("../consultation/consultation-client");

afterAll(closeTestApp);

/** IP window (60 min) + 24 h. */
const RETENTION_MS = 60 * 60_000 + 24 * 60 * 60_000;

const invalidBody = () => ({ ...signupBody(), cpf: "123" });

/** The IP's throttle rows once `count` of them have their outcome written. */
function settledRows(ip: string, count: number) {
  return waitFor(
    () => throttleRepository.listByIpHmac(hashIp(ip)),
    (rows) => rows.length === count && rows.every((row) => row.statusCode !== null),
  );
}

describe("per-IP throttle", () => {
  it("refuses an IP over the cap counting invalid requests", async () => {
    const ip = uniqueIp();
    expect((await postConsultation(invalidBody(), { ip })).status).toBe(422);
    expect((await postConsultation(signupBody(), { ip })).status).toBe(202);
    expect((await postConsultation(signupBody(), { ip })).status).toBe(202);

    const fourth = await postConsultation(signupBody(), { ip });
    expect(fourth.status).toBe(429);
    expect((await readProblem(fourth)).code).toBe("IP_LIMIT");

    expect((await postConsultation(signupBody(), { ip: uniqueIp() })).status).toBe(202);

    // The requote route sits behind the same guard (its own counter per route).
    const requoteIp = uniqueIp();
    for (let sent = 0; sent < 3; sent += 1) {
      const answer = await postRequote(
        randomUUID(),
        { treatmentAmountCents: 500_000 },
        {
          ip: requoteIp,
        },
      );
      expect(answer.status).toBe(404);
    }
    const overRequote = await postRequote(
      randomUUID(),
      { treatmentAmountCents: 500_000 },
      {
        ip: requoteIp,
      },
    );
    expect(overRequote.status).toBe(429);
    expect((await readProblem(overRequote)).code).toBe("IP_LIMIT");
  });

  it("records the outcome of each counted request", async () => {
    const ip = uniqueIp();
    const cpf = uniqueCpf();
    expect((await postConsultation(signupBody({ cpf }), { ip })).status).toBe(202);
    expect((await postConsultation(invalidBody(), { ip })).status).toBe(422);
    expect((await postConsultation(signupBody({ cpf }), { ip })).status).toBe(429);
    expect((await postConsultation(signupBody(), { ip })).status).toBe(429);

    const rows = await settledRows(ip, 4);
    expect(rows.map((row) => [row.route, row.statusCode, row.errorCode])).toEqual([
      ["consultation.create", 202, null],
      ["consultation.create", 422, "VALIDATION"],
      ["consultation.create", 429, "PATIENT_LIMIT"],
      ["consultation.create", 429, "IP_LIMIT"],
    ]);
  });

  it("purges rows past retention", async () => {
    const ip = uniqueIp();
    await postConsultation(invalidBody(), { ip });
    await sleep(50);
    await postConsultation(invalidBody(), { ip });
    const [older, newer] = await settledRows(ip, 2);
    if (!older || !newer) throw new Error("expected two throttle rows");

    // The scheduled job on the real clock: both rows are fresh and stay.
    await throttlePurgeJob.handle([]);
    expect(await throttleRepository.listByIpHmac(hashIp(ip))).toHaveLength(2);

    // Exactly at the older row's retention edge nothing is past it yet.
    await throttleService.purgeExpired(new Date(older.createdAt.getTime() + RETENTION_MS));
    expect(await throttleRepository.listByIpHmac(hashIp(ip))).toHaveLength(2);

    // At the newer row's edge the older row is past retention and goes; the newer one stays.
    await throttleService.purgeExpired(new Date(newer.createdAt.getTime() + RETENTION_MS));
    const kept = await throttleRepository.listByIpHmac(hashIp(ip));
    expect(kept.map((row) => row.id)).toEqual([newer.id]);
  });
});
