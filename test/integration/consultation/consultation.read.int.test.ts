import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { LENDER_CODES } from "#/lib/enums";
import { env } from "#/server/infra/env/server-env";
import { lenderAttemptRepository } from "#/server/modules/lender/lender-attempt.repository";
import { createWorker } from "#/server/worker";

import { closeTestApp, testLenderRegistry } from "../setup/app-fetch";
import {
  choose,
  createConsultation,
  getConsultation,
  openEvents,
  readProblem,
  readView,
  sleep,
  waitFor,
  waitSettled,
} from "./consultation-client";

afterAll(closeTestApp);

describe("without a worker", () => {
  it("lazily finalizes a read past the deadline", async () => {
    const id = await createConsultation({}, "NORMAL");
    await sleep(env.CONSULTATION_DEADLINE_MS + 100);

    const view = await readView(id);

    expect(view.quoteStatus).toBe("SETTLED");
    expect(view.attempts.map(({ status, reason }) => ({ status, reason }))).toEqual(
      LENDER_CODES.map(() => ({ status: "UNAVAILABLE", reason: "TIMEOUT" })),
    );
    const stored = await lenderAttemptRepository.listByConsultation(id);
    expect(stored.every((row) => row.status === "UNAVAILABLE" && row.reason === "TIMEOUT")).toBe(
      true,
    );
  });

  it("answers 404 for an unknown consultation", async () => {
    const unknown = randomUUID();

    const responses = [
      await getConsultation(unknown),
      await openEvents(unknown),
      await choose(unknown, randomUUID()),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect((await readProblem(response)).code).toBe("CONSULTATION_NOT_FOUND");
    }
  });
});

describe("with the worker", () => {
  const worker = createWorker({ lenderRegistry: testLenderRegistry });
  beforeAll(() => worker.start());
  afterAll(() => worker.stop());

  it("restores the current state on reload", async () => {
    // Delta never answers in time here, so once Alfa, Beta and Gama settle the state holds still
    // until the deadline: a stable mid-consultation moment.
    const id = await createConsultation({}, "DELTA_TIMES_OUT");
    await waitFor(
      () => lenderAttemptRepository.listByConsultation(id),
      (rows) => rows.filter((row) => row.status !== "PENDING").length === 3,
    );

    const view = await readView(id);
    const stored = await lenderAttemptRepository.listByConsultation(id);

    expect(view.quoteStatus).toBe("QUOTING");
    expect(view.attempts.map((attempt) => attempt.lender)).toEqual([...LENDER_CODES]);
    const storedStatus = Object.fromEntries(stored.map((row) => [row.lender, row.status]));
    expect(view.attempts.map((attempt) => attempt.status)).toEqual(
      LENDER_CODES.map((lender) => storedStatus[lender]),
    );
    expect(storedStatus.DELTA).toBe("PENDING");
  });

  it("explains a no-approval outcome per lender", async () => {
    const id = await createConsultation({ treatmentAmountCents: 1_000_000 }, "NONE_APPROVE");

    const view = await waitSettled(id);

    expect(view.journeyStatus).toBe("NO_OFFER");
    expect(view.attempts.map(({ lender, status, reason }) => ({ lender, status, reason }))).toEqual(
      [
        { lender: "ALFA", status: "REFUSED", reason: "AMOUNT_ABOVE_LIMIT" },
        { lender: "BETA", status: "REFUSED", reason: "PROFILE_NOT_ELIGIBLE" },
        { lender: "GAMA", status: "REFUSED", reason: "PROFILE_NOT_ELIGIBLE" },
        { lender: "DELTA", status: "REFUSED", reason: "PROFILE_NOT_ELIGIBLE" },
      ],
    );
    expect(view.suggestion).toEqual({ treatmentAmountCents: 500_000 });
  });
});
