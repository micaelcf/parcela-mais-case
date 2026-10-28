import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { ListResponseSchema } from "#/lib/list/list-contract";
import { hashIp } from "#/server/lib/crypto/ip-hash";
import {
  ConsultationDetailSchema,
  ConsultationListItemSchema,
  SwitchLogItemSchema,
  ThrottleEventItemSchema,
} from "#/server/modules/backoffice/backoffice.dto";
import { lenderAttemptRepository } from "#/server/modules/lender/lender-attempt.repository";
import { createWorker } from "#/server/worker";

import { closeTestApp, testLenderRegistry } from "../setup/app-fetch";
import {
  choose,
  createConsultation,
  formatCpf,
  postConsultation,
  readCreatedId,
  readProblem,
  signupBody,
  uniqueCpf,
  uniqueIp,
  waitFor,
  waitSettled,
} from "../consultation/consultation-client";
import { backofficeFetch, getOk, login, readOk, USERNAME } from "./backoffice-client";

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

const ConsultationPage = ListResponseSchema(ConsultationListItemSchema);
const SwitchLogPage = ListResponseSchema(SwitchLogItemSchema);
const ThrottlePage = ListResponseSchema(ThrottleEventItemSchema);

const CPF_DIGITS = /\d{11}/;

/** A name token no other test in this file uses, so `q` isolates one test's rows. */
const uniqueToken = () => `Tok${randomUUID().replaceAll("-", "").slice(0, 10)}`;

function query(params: Record<string, string | number>): string {
  return new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();
}

/** Ids in the order a tiebreaker on `id` must produce among equal sort keys. */
const byId = (ids: string[], direction: "asc" | "desc") =>
  [...ids].sort((a, b) => (direction === "asc" ? a.localeCompare(b) : b.localeCompare(a)));

describe("backoffice consultation explorer", () => {
  it("lists consultations", async () => {
    const cpf = uniqueCpf();
    const token = uniqueToken();
    const id = await createConsultation(
      { cpf, fullName: `${token} Pereira`, treatmentAmountCents: 1_234_500 },
      "NONE_APPROVE",
    );

    const response = await backofficeFetch(`/consultations?${query({ q: token })}`, { cookie });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toMatch(/cpf/i);
    expect(text).not.toMatch(CPF_DIGITS);
    const page = await readOk(new Response(text), ConsultationPage);
    expect(Object.keys(page).sort()).toEqual(["items", "page", "pageSize", "total", "totalPages"]);
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(page.items).toHaveLength(1);
    const [item] = page.items;
    expect(item).toMatchObject({
      id,
      treatmentAmountCents: 1_234_500,
      simulationScenario: "NONE_APPROVE",
      patientName: `${token} Pereira`,
    });
    expect(["QUOTING", "OFFERS", "NO_OFFER", "CHOSEN"]).toContain(item?.status);
    expect(new Date(item?.createdAt ?? "").toISOString()).toBe(item?.createdAt);
    expect(Object.keys(item ?? {}).filter((key) => /cpf/i.test(key))).toEqual([]);
  });

  it("shows the full patient with decrypted CPF", async () => {
    const cpf = uniqueCpf();
    const body = signupBody({
      cpf: formatCpf(cpf),
      fullName: "Beatriz Souza Lima",
      // Typed with the country code: stored as the 11 national digits.
      phone: "+55 (11) 98765-4321",
      monthlyIncomeCents: 812_345,
      treatmentAmountCents: 1_500_000,
      simulationScenario: "ALL_APPROVE",
    });
    const id = await readCreatedId(await postConsultation(body));
    const settled = await waitSettled(id);
    const offer = settled.offers[0];
    if (!offer) throw new Error("ALL_APPROVE produced no offer");
    expect((await choose(id, offer.id)).status).toBe(200);

    const detail = await getOk(`/consultations/${id}`, cookie, ConsultationDetailSchema);
    expect(detail.patient).toMatchObject({
      cpf,
      fullName: "Beatriz Souza Lima",
      birthdate: body.birthdate,
      phone: "11987654321",
    });
    expect(detail.patient.cpf).toMatch(/^\d{11}$/);
    expect(detail.inputs).toMatchObject({
      monthlyIncomeCents: 812_345,
      treatmentAmountCents: 1_500_000,
      birthdate: body.birthdate,
    });
    expect(detail.inputs.ageYears).toBeGreaterThanOrEqual(18);
    expect(detail).toMatchObject({ id, quoteStatus: "SETTLED", status: "CHOSEN" });

    const stored = await lenderAttemptRepository.listByConsultation(id);
    expect(detail.attempts.map((attempt) => attempt.lender)).toEqual([
      "ALFA",
      "BETA",
      "GAMA",
      "DELTA",
    ]);
    for (const attempt of detail.attempts) {
      const row = stored.find((candidate) => candidate.id === attempt.id);
      if (!row) throw new Error(`attempt ${attempt.id} not stored`);
      expect(attempt).toMatchObject({
        lender: row.lender,
        status: row.status,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
        calledAt: row.calledAt?.toISOString() ?? null,
        settledAt: row.settledAt?.toISOString() ?? null,
      });
      expect(attempt.settledAt).not.toBeNull();
    }

    const finalView = await waitSettled(id);
    expect(
      detail.offers.map(({ id: offerId, lender, approvedCents, termMonths, installmentCents }) => ({
        id: offerId,
        lender,
        approvedCents,
        termMonths,
        installmentCents,
      })),
    ).toEqual(
      finalView.offers.map(
        ({ id: offerId, lender, approvedCents, termMonths, installmentCents }) => ({
          id: offerId,
          lender,
          approvedCents,
          termMonths,
          installmentCents,
        }),
      ),
    );
    expect(detail.choice).toEqual(finalView.choice);
    expect(detail.choice?.offerId).toBe(offer.id);
  });

  it("shows the patient address normalised, the latest submission winning", async () => {
    const cpf = uniqueCpf();
    const first = await createConsultation({
      cpf,
      address: {
        cep: "01310-100",
        street: "  Avenida Paulista ",
        number: " 1578 ",
        complement: "  Conjunto 12 ",
        neighborhood: " Bela Vista",
        city: "São Paulo ",
        state: "SP",
      },
    });

    const firstDetail = await getOk(`/consultations/${first}`, cookie, ConsultationDetailSchema);
    expect(firstDetail.patient.address).toEqual({
      cep: "01310100",
      street: "Avenida Paulista",
      number: "1578",
      complement: "Conjunto 12",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    });

    // Same CPF, new address without a complement: the patient keeps only the latest one.
    const second = await createConsultation({
      cpf,
      address: {
        cep: "20040002",
        street: "Rua da Assembleia",
        number: "S/N",
        complement: "   ",
        neighborhood: "Centro",
        city: "Rio de Janeiro",
        state: "RJ",
      },
    });
    const expected = {
      cep: "20040002",
      street: "Rua da Assembleia",
      number: "S/N",
      complement: null,
      neighborhood: "Centro",
      city: "Rio de Janeiro",
      state: "RJ",
    };
    for (const id of [first, second]) {
      const detail = await getOk(`/consultations/${id}`, cookie, ConsultationDetailSchema);
      expect(detail.patient.address).toEqual(expected);
    }
  });

  it("finds consultations by exact CPF only", async () => {
    const cpf = uniqueCpf();
    const first = await createConsultation({ cpf }, "NONE_APPROVE");
    const second = await createConsultation({ cpf, treatmentAmountCents: 900_000 }, "NONE_APPROVE");
    await createConsultation({}, "NONE_APPROVE");

    const found = await readOk(
      await backofficeFetch("/consultations/search-by-cpf", {
        method: "POST",
        cookie,
        body: { cpf: formatCpf(cpf) },
      }),
      ConsultationPage,
    );
    expect(found.total).toBe(2);
    expect(found.items.map((item) => item.id).sort()).toEqual([first, second].sort());

    const partial = await backofficeFetch("/consultations/search-by-cpf", {
      method: "POST",
      cookie,
      body: { cpf: cpf.slice(0, 9) },
    });
    expect(partial.status).toBe(422);
    expect((await readProblem(partial)).code).toBe("VALIDATION");
  });
});

describe("backoffice lists", () => {
  it("pages, sorts, filters and searches on the server", async () => {
    // ── consultations: 3 rows under one name token; two share an amount (id tiebreaker) ──
    const token = uniqueToken();
    const name = `${token} Almeida`;
    const low = await createConsultation(
      { fullName: name, treatmentAmountCents: 700_000 },
      "NONE_APPROVE",
    );
    const tiedA = await createConsultation(
      { fullName: name, treatmentAmountCents: 900_000 },
      "NONE_APPROVE",
    );
    const tiedB = await createConsultation(
      { fullName: name, treatmentAmountCents: 900_000 },
      "ALL_APPROVE",
    );
    const tied = [tiedA, tiedB];
    const consultationIds = async (params: Record<string, string | number>) =>
      (await getOk(`/consultations?${query({ q: token, ...params })}`, cookie, ConsultationPage))
        .items;

    const asc = await consultationIds({ sort: "treatmentAmountCents:asc" });
    expect(asc.map((item) => item.id)).toEqual([low, ...byId(tied, "asc")]);
    const desc = await consultationIds({ sort: "treatmentAmountCents:desc" });
    expect(desc.map((item) => item.id)).toEqual([...byId(tied, "desc"), low]);

    const secondPage = await getOk(
      `/consultations?${query({ q: token, sort: "treatmentAmountCents:asc", page: 2, pageSize: 2 })}`,
      cookie,
      ConsultationPage,
    );
    expect(secondPage).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect(secondPage.items.map((item) => item.id)).toEqual([byId(tied, "asc")[1]]);

    const filtered = await consultationIds({ simulationScenario: "ALL_APPROVE" });
    expect(filtered.map((item) => item.id)).toEqual([tiedB]);
    const ranged = await consultationIds({ treatmentAmountCentsFrom: 800_000 });
    expect(ranged.map((item) => item.id).sort()).toEqual([...tied].sort());
    // `q` alone narrows the whole table to this token's rows.
    expect((await consultationIds({})).map((item) => item.id).sort()).toEqual(
      [low, ...tied].sort(),
    );

    // ── search by CPF: the same controls in the POST body, scoped to one patient ──
    const cpf = uniqueCpf();
    const cpfToken = uniqueToken();
    const cpfName = `${cpfToken} Rocha`;
    const cpfLow = await createConsultation(
      { cpf, fullName: cpfName, treatmentAmountCents: 700_000 },
      "NONE_APPROVE",
    );
    const cpfTiedA = await createConsultation(
      { cpf, fullName: cpfName, treatmentAmountCents: 900_000 },
      "NONE_APPROVE",
    );
    const cpfTiedB = await createConsultation(
      { cpf, fullName: cpfName, treatmentAmountCents: 900_000 },
      "ALL_APPROVE",
    );
    const cpfTied = [cpfTiedA, cpfTiedB];
    const searchByCpf = async (params: Record<string, string | number>) =>
      readOk(
        await backofficeFetch("/consultations/search-by-cpf", {
          method: "POST",
          cookie,
          body: { cpf: formatCpf(cpf), ...params },
        }),
        ConsultationPage,
      );
    const cpfIds = async (params: Record<string, string | number>) =>
      (await searchByCpf(params)).items.map((item) => item.id);

    expect(await cpfIds({ sort: "treatmentAmountCents:asc" })).toEqual([
      cpfLow,
      ...byId(cpfTied, "asc"),
    ]);
    expect(await cpfIds({ sort: "treatmentAmountCents:desc" })).toEqual([
      ...byId(cpfTied, "desc"),
      cpfLow,
    ]);
    const cpfSecondPage = await searchByCpf({
      sort: "treatmentAmountCents:asc",
      page: 2,
      pageSize: 2,
    });
    expect(cpfSecondPage).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect(cpfSecondPage.items.map((item) => item.id)).toEqual([byId(cpfTied, "asc")[1]]);
    expect(await cpfIds({ simulationScenario: "ALL_APPROVE" })).toEqual([cpfTiedB]);
    expect((await cpfIds({ treatmentAmountCentsFrom: 800_000 })).sort()).toEqual(
      [...cpfTied].sort(),
    );
    expect((await cpfIds({ q: cpfToken })).sort()).toEqual([cpfLow, ...cpfTied].sort());
    // `q` narrows within the CPF's rows: the explorer token's rows never join them.
    expect((await searchByCpf({ q: token })).total).toBe(0);

    // ── switch log: four changes on Beta (ends enabled) ──
    for (const enabled of [false, true, false, true]) {
      const response = await backofficeFetch("/lenders/beta/switch", {
        method: "PUT",
        cookie,
        body: { enabled },
      });
      expect(response.status).toBe(200);
    }
    const switchLog = async (params: Record<string, string | number>) =>
      getOk(`/lenders/switch-log?${query({ lender: "BETA", ...params })}`, cookie, SwitchLogPage);
    const allBeta = await switchLog({ pageSize: 100 });
    expect(allBeta.total).toBe(4);
    const betaIds = allBeta.items.map((item) => item.id);
    // Every row has the same `lender`, so the order is the id tiebreaker's.
    expect((await switchLog({ sort: "lender:asc" })).items.map((item) => item.id)).toEqual(
      byId(betaIds, "asc"),
    );
    expect((await switchLog({ sort: "lender:desc" })).items.map((item) => item.id)).toEqual(
      byId(betaIds, "desc"),
    );
    const disabledOnly = await switchLog({ enabled: "false" });
    expect(disabledOnly.total).toBe(2);
    expect(disabledOnly.items.every((item) => !item.enabled)).toBe(true);
    const searched = await switchLog({ q: USERNAME.slice(0, 5) });
    expect(searched.total).toBe(4);
    expect((await switchLog({ q: "ninguem" })).total).toBe(0);
    // The default sort is newest first, so the oldest-first page 2 is the default list's 3rd row.
    const pageTwo = await switchLog({ sort: "createdAt:asc", page: 2, pageSize: 1 });
    expect(pageTwo).toMatchObject({ page: 2, pageSize: 1, total: 4, totalPages: 4 });
    expect(pageTwo.items.map((item) => item.id)).toEqual([allBeta.items[2]?.id]);

    // ── throttle events: two 202s and one 422 from one IP ──
    const ip = uniqueIp();
    const ipHash = hashIp(ip).toString("hex").slice(0, 8);
    expect((await postConsultation(signupBody(), { ip })).status).toBe(202);
    expect((await postConsultation({ ...signupBody(), cpf: "123" }, { ip })).status).toBe(422);
    expect((await postConsultation(signupBody(), { ip })).status).toBe(202);
    const events = async (params: Record<string, string | number>) =>
      getOk(`/throttle-events?${query({ ipHash, ...params })}`, cookie, ThrottlePage);
    const all = await waitFor(
      () => events({ pageSize: 100 }),
      (page) => page.total === 3 && page.items.every((item) => item.statusCode !== null),
    );
    const accepted = all.items.filter((item) => item.statusCode === 202).map((item) => item.id);
    const [rejected] = all.items.filter((item) => item.statusCode === 422).map((item) => item.id);
    expect(accepted).toHaveLength(2);
    expect((await events({ sort: "statusCode:asc" })).items.map((item) => item.id)).toEqual([
      ...byId(accepted, "asc"),
      rejected,
    ]);
    expect((await events({ sort: "statusCode:desc" })).items.map((item) => item.id)).toEqual([
      rejected,
      ...byId(accepted, "desc"),
    ]);
    const validationOnly = await events({ q: "VALIDATION" });
    expect(validationOnly.items.map((item) => [item.id, item.errorCode, item.ipHash])).toEqual([
      [rejected, "VALIDATION", ipHash],
    ]);
    const byStatus = await events({ statusCode: 202, page: 2, pageSize: 1 });
    expect(byStatus).toMatchObject({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
  });

  it("rejects unknown sort and filter fields", async () => {
    // The CPF search carries its CPF in the body, so its unknown filter is another key.
    const endpoints: ReadonlyArray<{ path: string; post?: Record<string, string> }> = [
      { path: "/consultations" },
      { path: "/lenders/switch-log" },
      { path: "/throttle-events" },
      { path: "/consultations/search-by-cpf", post: { cpf: uniqueCpf() } },
    ];
    const outcomes: string[] = [];
    for (const { path, post } of endpoints) {
      const cases: Array<Record<string, string>> = [
        { sort: "nope:asc" },
        post ? { cpfHmac: "00" } : { cpf: uniqueCpf() },
      ];
      for (const params of cases) {
        const response = post
          ? await backofficeFetch(path, { method: "POST", cookie, body: { ...post, ...params } })
          : await backofficeFetch(`${path}?${query(params)}`, { cookie });
        const code = response.status === 422 ? (await readProblem(response)).code : "";
        outcomes.push(`${path} ${Object.keys(params)[0]}: ${response.status} ${code}`);
      }
    }
    expect(outcomes).toEqual([
      "/consultations sort: 422 VALIDATION",
      "/consultations cpf: 422 VALIDATION",
      "/lenders/switch-log sort: 422 VALIDATION",
      "/lenders/switch-log cpf: 422 VALIDATION",
      "/throttle-events sort: 422 VALIDATION",
      "/throttle-events cpf: 422 VALIDATION",
      "/consultations/search-by-cpf sort: 422 VALIDATION",
      "/consultations/search-by-cpf cpfHmac: 422 VALIDATION",
    ]);
  });
});
