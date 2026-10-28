import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { SimulationScenario } from "#/lib/enums";

// Low caps so the abuse test can hit both limits. Set before any app module reads the env.
process.env.RATE_LIMIT_IP_MAX = "5";
process.env.RATE_LIMIT_PATIENT_MAX = "2";

const { LENDER_CODES } = await import("#/lib/enums");
const { hashIp } = await import("#/server/lib/crypto/ip-hash");
const { AbuseMetricsSchema, ConsultationDetailSchema, LenderMetricsSchema, PipelineMetricsSchema } =
  await import("#/server/modules/backoffice/backoffice.dto");
const { consultationRepository } =
  await import("#/server/modules/consultation/consultation.repository");
const { lenderAttemptRepository } =
  await import("#/server/modules/lender/lender-attempt.repository");
const { createWorker } = await import("#/server/worker");
const { closeTestApp, testLenderRegistry } = await import("../setup/app-fetch");
const {
  choose,
  createConsultation,
  postConsultation,
  readCreatedId,
  readView,
  signupBody,
  uniqueCpf,
  uniqueIp,
  waitFor,
  waitSettled,
} = await import("../consultation/consultation-client");
const { getOk, login } = await import("./backoffice-client");

const worker = createWorker({ lenderRegistry: testLenderRegistry });
let cookie = "";
beforeAll(async () => {
  await worker.start();
  cookie = await login();
});
afterAll(async () => {
  await worker.stop();
  await closeTestApp();
});

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/** Creates consultations one by one and waits until all settle; ids in creation order. */
async function createSettled(
  inputs: ReadonlyArray<{ scenario: SimulationScenario; amountCents: number }>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const input of inputs) {
    ids.push(await createConsultation({ treatmentAmountCents: input.amountCents }, input.scenario));
  }
  await Promise.all(ids.map((id) => waitSettled(id)));
  return ids;
}

/** `[earliest created_at, latest created_at + 1 ms)` of the given consultations (database clock). */
async function creationRange(ids: string[]): Promise<{ from: Date; to: Date }> {
  const rows = await Promise.all(ids.map((id) => consultationRepository.findById(id)));
  const times = rows.map((row) => {
    if (!row) throw new Error("consultation not stored");
    return row.createdAt.getTime();
  });
  return { from: new Date(Math.min(...times)), to: new Date(Math.max(...times) + 1) };
}

/** Each consultation's highest APPROVED amount (0 without an approval), from the stored attempts. */
async function bestApproved(id: string): Promise<number> {
  const attempts = await lenderAttemptRepository.listByConsultation(id);
  return Math.max(
    0,
    ...attempts.filter((a) => a.status === "APPROVED").map((a) => a.approvedCents ?? 0),
  );
}

type PipelineFixture = {
  ids: string[];
  range: { from: Date; to: Date };
  chosen: Array<{
    lender: string;
    approvedCents: number;
    installmentCents: number;
    totalCents: number;
  }>;
};

let pipelineFixture: Promise<PipelineFixture> | undefined;

/**
 * Known inputs shared by the pipeline checks: two ALL_APPROVE consultations (each gets a choice,
 * from two different lenders) and one NONE_APPROVE.
 */
function pipelineInputs(): Promise<PipelineFixture> {
  pipelineFixture ??= (async () => {
    const ids = await createSettled([
      { scenario: "ALL_APPROVE", amountCents: 1_000_000 },
      { scenario: "ALL_APPROVE", amountCents: 2_000_000 },
      { scenario: "NONE_APPROVE", amountCents: 500_000 },
    ]);
    const chosen: PipelineFixture["chosen"] = [];
    for (const [index, id] of ids.slice(0, 2).entries()) {
      const view = await readView(id);
      const lenders = [...new Set(view.offers.map((offer) => offer.lender))];
      // A different lender for each choice, so chosenByLender has two non-zero entries.
      const lender = lenders[index % lenders.length];
      const offer = view.offers.find((candidate) => candidate.lender === lender);
      if (!offer) throw new Error("ALL_APPROVE produced no offer");
      expect((await choose(id, offer.id)).status).toBe(200);
      chosen.push(offer);
    }
    return { ids, range: await creationRange(ids), chosen };
  })();
  return pipelineFixture;
}

function pipelinePath(range: { from: Date; to: Date }, bucket: "hour" | "day"): string {
  return `/metrics/pipeline?${query({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    bucket,
  })}`;
}

/** Linear-interpolation percentile, as Postgres `percentile_cont`. */
function percentileCont(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  return low + ((sorted[upper] ?? low) - low) * (position - lower);
}

describe("backoffice metrics", () => {
  it("sums requested, approved and chosen volume per bucket", async () => {
    const { ids, range, chosen } = await pipelineInputs();
    const consultations = await Promise.all(
      ids.map(async (id) => {
        const row = await consultationRepository.findById(id);
        if (!row) throw new Error("consultation not stored");
        const view = await readView(id);
        const chosenOffer = view.offers.find((offer) => offer.id === view.choice?.offerId);
        return {
          createdAt: row.createdAt.getTime(),
          requested: row.treatmentAmountCents,
          approved: await bestApproved(id),
          chosen: chosenOffer?.approvedCents ?? 0,
        };
      }),
    );
    expect(chosen).toHaveLength(2);

    for (const [bucket, width] of [
      ["hour", HOUR_MS],
      ["day", DAY_MS],
    ] as const) {
      const metrics = await getOk(pipelinePath(range, bucket), cookie, PipelineMetricsSchema);
      const expected = new Map<string, { requested: number; approved: number; chosen: number }>();
      for (const row of consultations) {
        const start = new Date(Math.floor(row.createdAt / width) * width).toISOString();
        const sums = expected.get(start) ?? { requested: 0, approved: 0, chosen: 0 };
        sums.requested += row.requested;
        sums.approved += row.approved;
        sums.chosen += row.chosen;
        expected.set(start, sums);
      }
      const nonEmpty = metrics.series.filter((point) => point.consultations > 0);
      expect(
        Object.fromEntries(
          nonEmpty.map((point) => [
            point.bucketStart,
            {
              requested: point.requestedCents,
              approved: point.approvedCents,
              chosen: point.chosenCents,
            },
          ]),
        ),
      ).toEqual(Object.fromEntries(expected));
      expect(metrics.totals).toMatchObject({
        consultations: 3,
        requestedCents: 3_500_000,
        approvedCents: consultations.reduce((sum, row) => sum + row.approved, 0),
        chosenCents: consultations.reduce((sum, row) => sum + row.chosen, 0),
      });
    }
  });

  it("derives pipeline ratios and chosen averages", async () => {
    const { ids, range, chosen } = await pipelineInputs();
    const approved = await Promise.all(ids.map(bestApproved));
    const requested = 3_500_000;
    const metrics = await getOk(pipelinePath(range, "day"), cookie, PipelineMetricsSchema);

    expect(metrics.totals.settledConsultations).toBe(3);
    expect(metrics.totals.approvalRate).toBeCloseTo(
      approved.filter((value) => value > 0).length / 3,
      10,
    );
    expect(metrics.totals.approvedRequestedRatio).toBeCloseTo(
      approved.reduce((sum, value) => sum + value, 0) / requested,
      10,
    );
    expect(metrics.totals.avgChosenInstallmentCents).toBe(
      Math.round(chosen.reduce((sum, offer) => sum + offer.installmentCents, 0) / chosen.length),
    );
    expect(metrics.totals.avgChosenTotalCents).toBe(
      Math.round(chosen.reduce((sum, offer) => sum + offer.totalCents, 0) / chosen.length),
    );
    expect(metrics.chosenByLender).toEqual(
      LENDER_CODES.map((lender) => {
        const mine = chosen.filter((offer) => offer.lender === lender);
        return {
          lender,
          chosenOffers: mine.length,
          chosenCents: mine.reduce((sum, offer) => sum + offer.approvedCents, 0),
        };
      }),
    );
  });

  it("reports lender latency percentiles and outcome rates", async () => {
    const ids = await createSettled([
      { scenario: "ALL_APPROVE", amountCents: 1_000_000 },
      { scenario: "ALL_APPROVE", amountCents: 1_500_000 },
      { scenario: "NONE_APPROVE", amountCents: 1_000_000 },
      { scenario: "DELTA_FAILS", amountCents: 1_000_000 },
      { scenario: "DELTA_TIMES_OUT", amountCents: 1_000_000 },
    ]);
    const attempts = (
      await Promise.all(ids.map((id) => lenderAttemptRepository.listByConsultation(id)))
    ).flat();
    const settledTimes = attempts.map((attempt) => {
      if (!attempt.settledAt) throw new Error("attempt not settled");
      return attempt.settledAt.getTime();
    });
    const { from } = await creationRange(ids);
    const to = new Date(Math.max(...settledTimes) + 1);

    const metrics = await getOk(
      `/metrics/lenders?${query({ from: from.toISOString(), to: to.toISOString() })}`,
      cookie,
      LenderMetricsSchema,
    );
    expect(metrics.lenders.map((row) => row.lender)).toEqual([...LENDER_CODES]);
    for (const row of metrics.lenders) {
      const mine = attempts.filter((attempt) => attempt.lender === row.lender);
      const count = (match: (attempt: (typeof mine)[number]) => boolean) =>
        mine.filter(match).length;
      const settled = mine.length;
      const latencies = mine
        .filter((attempt) => attempt.calledAt !== null && attempt.latencyMs !== null)
        .map((attempt) => attempt.latencyMs ?? 0);
      expect(row.settledAttempts).toBe(settled);
      expect(row.calledAttempts).toBe(count((attempt) => attempt.calledAt !== null));
      const p50 = percentileCont(latencies, 0.5);
      const p95 = percentileCont(latencies, 0.95);
      if (p50 === null) expect(row.p50LatencyMs).toBeNull();
      else expect(row.p50LatencyMs).toBeCloseTo(p50, 6);
      if (p95 === null) expect(row.p95LatencyMs).toBeNull();
      else expect(row.p95LatencyMs).toBeCloseTo(p95, 6);

      const approved = count((attempt) => attempt.status === "APPROVED");
      const refused = count((attempt) => attempt.status === "REFUSED");
      const errors = count(
        (attempt) =>
          attempt.status === "UNAVAILABLE" &&
          (attempt.reason === "LENDER_ERROR" || attempt.reason === "INTEGRATION_ERROR"),
      );
      const timeouts = count(
        (attempt) => attempt.status === "UNAVAILABLE" && attempt.reason === "TIMEOUT",
      );
      expect(row).toMatchObject({ approved, refused, errors, timeouts });
      expect(row.approvalRate).toBeCloseTo(approved / settled, 10);
      expect(row.refusalRate).toBeCloseTo(refused / settled, 10);
      expect(row.errorRate).toBeCloseTo(errors / settled, 10);
      expect(row.timeoutRate).toBeCloseTo(timeouts / settled, 10);
    }
    // The mixed scenarios exercise every rate.
    for (const rate of ["approvalRate", "refusalRate", "errorRate", "timeoutRate"] as const) {
      expect(metrics.lenders.some((row) => (row[rate] ?? 0) > 0)).toBe(true);
    }
  });

  it("summarises abuse in the last 24 h", async () => {
    const ipHashOf = (ip: string) => hashIp(ip).toString("hex").slice(0, 8);
    const heavyIp = uniqueIp();
    const otherIp = uniqueIp();
    const ana = uniqueCpf();
    const bruno = uniqueCpf();
    const statuses: number[] = [];
    const send = async (cpf: string, fullName: string, ip: string) => {
      const response = await postConsultation(signupBody({ cpf, fullName }), { ip });
      statuses.push(response.status);
      return response;
    };

    // Heavy IP (cap 5): Ana ×3 (the 3rd hits the patient cap of 2), then 4 new patients
    // (requests 6 and 7 hit the IP cap).
    const anaFirst = await send(ana, "Ana Ribeiro", heavyIp);
    await send(ana, "Ana Ribeiro", heavyIp);
    await send(ana, "Ana Ribeiro", heavyIp);
    for (let sent = 0; sent < 4; sent += 1) await send(uniqueCpf(), "Carlos Dias", heavyIp);
    // Another IP: Bruno ×2, both accepted.
    const brunoFirst = await send(bruno, "Bruno Costa", otherIp);
    await send(bruno, "Bruno Costa", otherIp);
    expect(statuses).toEqual([202, 202, 429, 202, 202, 429, 429, 202, 202]);

    const patientIdOf = async (created: Response) => {
      const id = await readCreatedId(created);
      const detail = await getOk(`/consultations/${id}`, cookie, ConsultationDetailSchema);
      return detail.patient.id;
    };
    const anaId = await patientIdOf(anaFirst);
    const brunoId = await patientIdOf(brunoFirst);

    // Outcomes are recorded after each response; wait for all three 429s.
    const metrics = await waitFor(
      () => getOk("/metrics/abuse", cookie, AbuseMetricsSchema),
      (value) => value.tooManyRequests === 3,
    );
    expect(metrics.limitHits).toEqual({ IP_LIMIT: 2, PATIENT_LIMIT: 1 });
    expect(metrics.tooManyRequests).toBe(3);
    expect(new Date(metrics.to).getTime() - new Date(metrics.from).getTime()).toBe(DAY_MS);

    expect(metrics.topIps.slice(0, 2)).toEqual([
      { ipHash: ipHashOf(heavyIp), requests: 7, tooManyRequests: 3 },
      { ipHash: ipHashOf(otherIp), requests: 2, tooManyRequests: 0 },
    ]);
    expect(metrics.topIps.every((row) => /^[0-9a-f]{8}$/.test(row.ipHash))).toBe(true);

    const topTwo = metrics.topPatients.slice(0, 2);
    expect([...topTwo].sort((a, b) => a.firstName.localeCompare(b.firstName))).toEqual([
      { patientId: anaId, firstName: "Ana", consultations: 2 },
      { patientId: brunoId, firstName: "Bruno", consultations: 2 },
    ]);
    const serialized = JSON.stringify(metrics);
    expect(serialized).not.toMatch(/cpf/i);
    expect(serialized).not.toMatch(/\d{11}/);
  });
});
