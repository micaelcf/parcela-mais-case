import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

// Every NORMAL Delta call fails, so 20 consultations open its circuit. Set before any app module
// reads the env (dynamic imports below).
process.env.SIMULATOR_DELTA_FAILURE_RATE = "1";

const { LENDER_CODES } = await import("#/lib/enums");
const { ListResponseSchema } = await import("#/lib/list/list-contract");
const { LenderMetricsSchema, LenderStateSchema, SwitchLogItemSchema } =
  await import("#/server/modules/backoffice/backoffice.dto");
const { BREAKER } = await import("#/server/modules/lender/circuit-breaker");
const { lenderAttemptRepository } =
  await import("#/server/modules/lender/lender-attempt.repository");
const { createWorker } = await import("#/server/worker");
const { closeTestApp, testLenderRegistry } = await import("../setup/app-fetch");
const { createConsultation, readProblem, waitSettled } =
  await import("../consultation/consultation-client");
const { backofficeFetch, getOk, login, readOk, USERNAME } = await import("./backoffice-client");

const SwitchLogPage = ListResponseSchema(SwitchLogItemSchema);

let cookie = "";
beforeAll(async () => {
  cookie = await login();
});
afterAll(closeTestApp);

function setSwitch(slug: string, enabled: boolean): Promise<Response> {
  return backofficeFetch(`/lenders/${slug}/switch`, { method: "PUT", cookie, body: { enabled } });
}

async function deltaAttemptOf(consultationId: string) {
  const rows = await lenderAttemptRepository.listByConsultation(consultationId);
  const delta = rows.find((row) => row.lender === "DELTA");
  if (!delta) throw new Error("no Delta attempt");
  return delta;
}

const lenderMetrics = () => getOk("/metrics/lenders", cookie, LenderMetricsSchema);

describe("backoffice lender health", () => {
  // Declared first: it needs every lender queue untouched by a worker in this file.
  it("reports queue backlog per lender", async () => {
    for (let created = 0; created < 3; created += 1) await createConsultation({}, "ALL_APPROVE");
    const metrics = await lenderMetrics();
    expect(
      Object.fromEntries(metrics.lenders.map((row) => [row.lender, row.queueBacklog])),
    ).toEqual(Object.fromEntries(LENDER_CODES.map((lender) => [lender, 3])));
  });

  describe("with the worker running", () => {
    const worker = createWorker({ lenderRegistry: testLenderRegistry });
    beforeAll(() => worker.start());
    afterAll(() => worker.stop());

    it("toggles a lender through the API", async () => {
      const disabled = await setSwitch("delta", false);
      expect(disabled.status).toBe(200);
      expect(await readOk(disabled, LenderStateSchema)).toMatchObject({
        lender: "DELTA",
        enabled: false,
      });
      const skipped = await createConsultation({}, "ALL_APPROVE");
      await waitSettled(skipped);
      expect(await deltaAttemptOf(skipped)).toMatchObject({
        status: "UNAVAILABLE",
        reason: "DISABLED",
        calledAt: null,
      });

      const enabled = await setSwitch("delta", true);
      expect(await readOk(enabled, LenderStateSchema)).toMatchObject({
        lender: "DELTA",
        enabled: true,
      });
      const called = await createConsultation({}, "ALL_APPROVE");
      await waitSettled(called);
      const delta = await deltaAttemptOf(called);
      expect(delta.calledAt).not.toBeNull();
      expect(delta.reason).not.toBe("DISABLED");
    });

    it("logs every switch change append-only", async () => {
      expect((await setSwitch("gama", false)).status).toBe(200);
      expect((await setSwitch("gama", true)).status).toBe(200);

      // Default sort: newest first.
      const log = await getOk("/lenders/switch-log?lender=GAMA", cookie, SwitchLogPage);
      expect(log.total).toBe(2);
      const [newest, oldest] = log.items;
      expect(newest).toMatchObject({ lender: "GAMA", enabled: true, actor: USERNAME });
      expect(oldest).toMatchObject({ lender: "GAMA", enabled: false, actor: USERNAME });
      for (const entry of log.items) {
        expect(new Date(entry.createdAt).toISOString()).toBe(entry.createdAt);
      }
      expect(Date.parse(newest?.createdAt ?? "")).toBeGreaterThanOrEqual(
        Date.parse(oldest?.createdAt ?? ""),
      );

      // No path changes or removes an entry.
      const entryId = oldest?.id ?? randomUUID();
      for (const method of ["PUT", "PATCH", "DELETE"]) {
        const response = await backofficeFetch(`/lenders/switch-log/${entryId}`, {
          method,
          cookie,
          body: method === "DELETE" ? undefined : { enabled: true },
        });
        expect([method, response.status]).toEqual([method, 404]);
        expect((await readProblem(response)).code).toBe("NOT_FOUND");
      }
      const after = await getOk("/lenders/switch-log?lender=GAMA", cookie, SwitchLogPage);
      expect(after.items).toEqual(log.items);
    });

    it(
      "shows circuit and kill-switch state",
      // 20 NORMAL consultations, each waiting out Delta's failure.
      { timeout: 90_000 },
      async () => {
        const ids = await Promise.all(
          Array.from({ length: BREAKER.windowSize }, () => createConsultation({}, "NORMAL")),
        );
        await Promise.all(ids.map((id) => waitSettled(id)));

        const opened = await lenderMetrics();
        expect(opened.lenders.find((row) => row.lender === "DELTA")).toMatchObject({
          breaker: "OPEN",
          enabled: true,
        });

        expect((await setSwitch("delta", false)).status).toBe(200);
        const disabled = await lenderMetrics();
        expect(disabled.lenders.find((row) => row.lender === "DELTA")).toMatchObject({
          breaker: "OPEN",
          enabled: false,
        });
        expect(
          disabled.lenders.filter((row) => row.lender !== "DELTA").map((row) => row.enabled),
        ).toEqual([true, true, true]);
      },
    );
  });
});
