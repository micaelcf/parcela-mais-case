import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { env } from "#/server/infra/env/server-env";
import { logger } from "#/server/lib/log/logger";
import { consultationService } from "#/server/modules/consultation/consultation.service";
import { lenderAttemptRepository } from "#/server/modules/lender/lender-attempt.repository";
import { createWorker } from "#/server/worker";

import { closeTestApp, testLenderRegistry } from "../setup/app-fetch";
import {
  createConsultation,
  readView,
  sleep,
  uniqueCpf,
  waitFor,
  waitSettled,
} from "./consultation-client";

/** Every JSON line the logger writes while the file runs (one per event). */
const lines: string[] = [];
logger.attachTransport({
  format: "json",
  write: (_record, line) => {
    lines.push(line);
  },
});

type LenderCallLine = {
  event: "lender.call";
  lender: string;
  attemptId: string;
  latencyMs: number;
  outcome: string;
  reason: string | null;
};

function lenderCallLines(attemptId: string): LenderCallLine[] {
  const found: LenderCallLine[] = [];
  for (const line of lines) {
    if (!line.includes('"lender.call"')) continue;
    const parsed: unknown = JSON.parse(line);
    if (
      parsed &&
      typeof parsed === "object" &&
      "event" in parsed &&
      parsed.event === "lender.call" &&
      "attemptId" in parsed &&
      parsed.attemptId === attemptId
    ) {
      // The logger's line for this event; its fields are asserted by the tests below.
      const call = parsed as LenderCallLine;
      found.push(call);
    }
  }
  return found;
}

async function attemptsOf(id: string) {
  const rows = await lenderAttemptRepository.listByConsultation(id);
  return Object.fromEntries(rows.map((row) => [row.lender, row]));
}

const worker = createWorker({ lenderRegistry: testLenderRegistry });
beforeAll(() => worker.start());
afterAll(async () => {
  await worker.stop();
  await closeTestApp();
});

describe("orchestration", () => {
  it("times out a lender that never answers", async () => {
    const id = await createConsultation({}, "DELTA_TIMES_OUT");

    const view = await waitSettled(id);

    const delta = view.attempts.find((attempt) => attempt.lender === "DELTA");
    expect(delta).toMatchObject({ status: "UNAVAILABLE", reason: "TIMEOUT" });
    expect(view.quoteStatus).toBe("SETTLED");
    const elapsed = Date.parse(view.settledAt ?? "") - Date.parse(view.createdAt);
    expect(elapsed).toBeLessThanOrEqual(env.CONSULTATION_DEADLINE_MS + 1000);
  });

  it("isolates a lender 500 to that lender", async () => {
    // Alfa: income × 10 ≥ amount → approve 100 %; Beta: 60 %; Gama: age 40, amount ≤ 20 000 → 100 %.
    const id = await createConsultation(
      { monthlyIncomeCents: 1_000_000, treatmentAmountCents: 1_000_000 },
      "DELTA_FAILS",
    );

    const view = await waitSettled(id);

    const byLender = Object.fromEntries(view.attempts.map((attempt) => [attempt.lender, attempt]));
    expect(byLender.DELTA).toMatchObject({ status: "UNAVAILABLE", reason: "LENDER_ERROR" });
    expect(byLender.ALFA).toMatchObject({ status: "APPROVED", approvedCents: 1_000_000 });
    expect(byLender.BETA).toMatchObject({ status: "APPROVED", approvedCents: 600_000 });
    expect(byLender.GAMA).toMatchObject({ status: "APPROVED", approvedCents: 1_000_000 });
    const deltaAttempt = (await attemptsOf(id)).DELTA;
    expect(lenderCallLines(deltaAttempt?.id ?? "")).toHaveLength(1);
  });

  it("keeps the finalizer outcome when the worker answers late", async () => {
    const id = await createConsultation({}, "ALL_APPROVE");
    // Delta (ALL_APPROVE: 0.8–1.6 s here) has been called and hasn't answered yet.
    const inFlight = await waitFor(
      () => attemptsOf(id),
      (attempts) => attempts.DELTA?.calledAt != null,
    );
    expect(inFlight.DELTA?.status).toBe("PENDING");
    const deltaId = inFlight.DELTA?.id ?? "";

    await consultationService.finalize(id);

    expect((await attemptsOf(id)).DELTA).toMatchObject({
      status: "UNAVAILABLE",
      reason: "TIMEOUT",
    });
    // Delta's answer arrives (its call is logged), then its settle TX runs and must lose.
    await waitFor(
      async () => lenderCallLines(deltaId),
      (calls) => calls.length === 1,
    );
    await sleep(500);
    const after = await attemptsOf(id);
    expect(after.DELTA).toMatchObject({ status: "UNAVAILABLE", reason: "TIMEOUT" });
    const view = await readView(id);
    expect(view.offers.filter((offer) => offer.lender === "DELTA")).toEqual([]);
  });

  it("calls the four lenders in parallel", async () => {
    const id = await createConsultation({}, "NORMAL");

    const attempts = await waitFor(
      () => lenderAttemptRepository.listByConsultation(id),
      (rows) => rows.every((row) => row.calledAt !== null),
    );

    const calledAt = attempts.map((row) => row.calledAt?.getTime() ?? Number.NaN);
    expect(Math.max(...calledAt) - Math.min(...calledAt)).toBeLessThanOrEqual(1000);
  });

  it("logs one PII-free line per lender call", async () => {
    const cpf = uniqueCpf();
    const fullName = "Joana Prudente Xavier";
    const phone = "21976543210";
    const monthlyIncomeCents = 1_234_567;
    const id = await createConsultation(
      { cpf, fullName, phone, monthlyIncomeCents, treatmentAmountCents: 1_000_000 },
      "NORMAL",
    );

    await waitSettled(id);
    // A settle commits after its log line; give the last line a moment to be written.
    await sleep(100);

    const called = (await lenderAttemptRepository.listByConsultation(id)).filter(
      (row) => row.calledAt !== null,
    );
    expect(called.length).toBeGreaterThan(0);
    for (const attempt of called) {
      const calls = lenderCallLines(attempt.id);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ lender: attempt.lender, attemptId: attempt.id });
      expect(typeof calls[0]?.latencyMs).toBe("number");
      expect(typeof calls[0]?.outcome).toBe("string");
      expect(calls[0]).toHaveProperty("reason");
    }
    const forbidden = [
      cpf,
      fullName,
      "Joana",
      "Xavier",
      phone,
      String(monthlyIncomeCents),
      "12345.67",
    ];
    for (const line of lines) {
      for (const value of forbidden) expect(line).not.toContain(value);
    }
  });
});
