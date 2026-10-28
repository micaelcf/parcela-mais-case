import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { Address } from "#/lib/address/address";
import { cpfCheckDigits } from "#/lib/cpf/cpf";
import type { ConsultationPublicView } from "#/server/modules/consultation/consultation.dto";
import { createWorker } from "#/server/worker";

import { closeTestApp, testLenderRegistry } from "../setup/app-fetch";
import {
  birthdateTurning,
  choose,
  createConsultation,
  formatCpf,
  postRequote,
  readCreatedId,
  readEvents,
  readView,
  type StreamEvent,
  uniqueCpf,
  waitSettled,
} from "./consultation-client";

const worker = createWorker({ lenderRegistry: testLenderRegistry });

/**
 * A fixed CPF: none of its 3-digit windows occurs in the catalogue's monthly rates ("0.024900",
 * "0.019900", "0.032900", "0.021900"), the only digit-bearing strings a public view legitimately
 * carries besides ids and timestamps.
 */
const CPF_BASE = "586371845";
const CPF = `${CPF_BASE}${cpfCheckDigits(CPF_BASE)}`;
const PHONE_DIGITS = "21976543210";
const INCOME_CENTS = 8_765_431;
const BIRTHDATE = birthdateTurning(44);
const [FIRST_NAME, ...OTHER_NAMES] = ["Joana", "Ribeiro", "Castanheira"];
/** A distinctive address: none of its street, number, neighbourhood or CEP may surface publicly. */
const ADDRESS: Address = {
  cep: "13087-415",
  street: "Rua Quixabeira Azulada",
  number: "4827B",
  complement: "Bloco Jatobá",
  neighborhood: "Jardim Ipezal",
  city: "Campinas",
  state: "SP",
};
/** A distinctive e-mail: neither its local part nor its domain may surface publicly. */
const EMAIL = "joana.castanheira.privacidade@quixabeira-azul.com.br";
const PATIENT = {
  fullName: [FIRST_NAME, ...OTHER_NAMES].join(" "),
  cpf: formatCpf(CPF),
  birthdate: BIRTHDATE,
  phone: "(21) 97654-3210",
  email: EMAIL,
  address: ADDRESS,
  monthlyIncomeCents: INCOME_CENTS,
  treatmentAmountCents: 1_200_000,
};

/**
 * A second patient whose NORMAL journeys make Alfa refuse with its income × 10 limit: the amounts
 * exceed that limit (Beta still approves 60 %), so the lender's refusal carries a number derived
 * from the income.
 */
const LOW_INCOME_CENTS = 234_567;
const ALFA_LIMIT_CENTS = LOW_INCOME_CENTS * 10;
const LOW_INCOME_PATIENT = {
  ...PATIENT,
  cpf: formatCpf(uniqueCpf()),
  monthlyIncomeCents: LOW_INCOME_CENTS,
  treatmentAmountCents: 2_400_000,
};

/** Income figures in cents (and their BRL decimals) that no public payload may carry. */
const INCOME_DERIVED_CENTS = [INCOME_CENTS, INCOME_CENTS * 10, LOW_INCOME_CENTS, ALFA_LIMIT_CENTS];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Every public payload of the journeys: GETs, SSE snapshots, choose and requote bodies;
 * `incomeRefusals` are the NORMAL views where Alfa refused on income.
 */
type Payloads = {
  views: ConsultationPublicView[];
  incomeRefusals: ConsultationPublicView[];
  all: unknown[];
};

async function snapshotsOf(
  stream: Promise<{ status: number; events: StreamEvent[] }>,
): Promise<unknown[]> {
  const { status, events } = await stream;
  expect(status).toBe(200);
  const snapshots = events.filter((event) => event.event === "snapshot").map((e) => e.data);
  expect(snapshots.length).toBeGreaterThan(0);
  return snapshots;
}

async function journeyPayloads(): Promise<Payloads> {
  const approvedId = await createConsultation(PATIENT, "ALL_APPROVE");
  const approvedStream = readEvents(approvedId);
  const refusedId = await createConsultation(PATIENT, "NONE_APPROVE");
  const refusedStream = readEvents(refusedId);
  const normalId = await createConsultation(LOW_INCOME_PATIENT);
  const normalStream = readEvents(normalId);
  const lowRefusedId = await createConsultation(
    { ...LOW_INCOME_PATIENT, treatmentAmountCents: 3_000_000 },
    "NONE_APPROVE",
  );

  const approved = await waitSettled(approvedId);
  const offer = approved.offers[0];
  if (!offer) throw new Error("ALL_APPROVE produced no offer");
  const chosen = await choose(approvedId, offer.id);
  expect(chosen.status).toBe(200);
  const chooseBody: unknown = await chosen.json();

  const normal = await waitSettled(normalId);
  const normalOffer = normal.offers[0];
  if (!normalOffer) throw new Error("NORMAL produced no offer");
  const normalChosen = await choose(normalId, normalOffer.id);
  expect(normalChosen.status).toBe(200);
  const normalChooseBody: unknown = await normalChosen.json();

  await waitSettled(refusedId);
  const requote = await postRequote(refusedId, { treatmentAmountCents: 600_000 });
  const requoteBody: unknown = JSON.parse(await requote.clone().text());
  const requotedId = await readCreatedId(requote);
  const requotedStream = readEvents(requotedId);
  await waitSettled(requotedId);

  await waitSettled(lowRefusedId);
  const normalRequote = await postRequote(lowRefusedId, { treatmentAmountCents: 2_500_000 });
  const normalRequoteBody: unknown = JSON.parse(await normalRequote.clone().text());
  const normalRequotedId = await readCreatedId(normalRequote);
  const normalRequotedStream = readEvents(normalRequotedId);
  await waitSettled(normalRequotedId);

  const snapshots = [
    ...(await snapshotsOf(approvedStream)),
    ...(await snapshotsOf(refusedStream)),
    ...(await snapshotsOf(requotedStream)),
    ...(await snapshotsOf(normalStream)),
    ...(await snapshotsOf(normalRequotedStream)),
  ];
  const incomeRefusalIds = [normalId, normalRequotedId];
  const views = await Promise.all(
    [approvedId, refusedId, requotedId, ...incomeRefusalIds].map(readView),
  );
  return {
    views,
    incomeRefusals: views.slice(-incomeRefusalIds.length),
    all: [...views, ...snapshots, chooseBody, normalChooseBody, requoteBody, normalRequoteBody],
  };
}

let payloads: Payloads;
beforeAll(async () => {
  await worker.start();
  payloads = await journeyPayloads();
});
afterAll(async () => {
  await worker.stop();
  await closeTestApp();
});

/** Every object key and leaf value in a JSON payload. */
function leaves(value: unknown, keys: string[] = [], values: unknown[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) leaves(item, keys, values);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.push(key);
      leaves(item, keys, values);
    }
  } else {
    values.push(value);
  }
  return { keys, values };
}

/** String leaves, minus ids and timestamps. */
function scannedStrings(all: unknown[]): string[] {
  return leaves(all).values.filter(
    (value): value is string =>
      typeof value === "string" && !UUID.test(value) && !ISO_TIMESTAMP.test(value),
  );
}

describe("public payload privacy", () => {
  it("public payloads carry no CPF digits", () => {
    const strings = scannedStrings(payloads.all);
    const windows = Array.from({ length: CPF.length - 2 }, (_, at) => CPF.slice(at, at + 3));
    const leaking = strings.filter((value) => windows.some((window) => value.includes(window)));
    expect(leaking).toEqual([]);

    const identityKeys = leaves(payloads.all).keys.filter((key) => /cpf|document|taxid/i.test(key));
    expect(identityKeys).toEqual([]);

    expect(strings.filter((value) => value.includes("*") || value.includes("•"))).toEqual([]);
  });

  it("public payloads carry only the first name", () => {
    const { keys, values } = leaves(payloads.all);
    const strings = scannedStrings(payloads.all);
    const [year, month, day] = BIRTHDATE.split("-");
    const forbidden = [
      BIRTHDATE,
      `${day}/${month}/${year}`,
      PHONE_DIGITS,
      ...INCOME_DERIVED_CENTS.map(String),
      ...OTHER_NAMES.map((name) => name.toLowerCase()),
    ];
    const leaking = strings.filter((value) =>
      forbidden.some((needle) => value.toLowerCase().includes(needle)),
    );
    expect(leaking).toEqual([]);
    const forbiddenNumbers = [
      Number(PHONE_DIGITS),
      ...INCOME_DERIVED_CENTS,
      ...INCOME_DERIVED_CENTS.map((cents) => cents / 100),
    ];
    expect(values.filter((value) => forbiddenNumbers.includes(Number(value)))).toEqual([]);
    expect(keys.filter((key) => key === "maxApprovableCents")).toEqual([]);

    // Positive control: Alfa did refuse on income in both NORMAL journeys.
    for (const view of payloads.incomeRefusals) {
      expect(view.attempts.find((attempt) => attempt.lender === "ALFA")).toMatchObject({
        status: "REFUSED",
        reason: "AMOUNT_ABOVE_LIMIT",
      });
    }

    for (const view of payloads.views) expect(view.patientFirstName).toBe(FIRST_NAME);
    const firstNames = payloads.all.flatMap((payload) =>
      payload !== null && typeof payload === "object" && "patientFirstName" in payload
        ? [payload.patientFirstName]
        : [],
    );
    // 5 GETs + at least one snapshot per stream + the two choose responses.
    expect(firstNames.length).toBeGreaterThanOrEqual(12);
    expect(new Set(firstNames)).toEqual(new Set([FIRST_NAME]));
  });

  it("public payloads carry no address", () => {
    const { keys, values } = leaves(payloads.all);
    const cepDigits = ADDRESS.cep.replace(/\D/g, "");
    const forbidden = [
      ADDRESS.cep,
      cepDigits,
      ADDRESS.street,
      ADDRESS.number,
      ADDRESS.complement ?? "",
      ADDRESS.neighborhood,
    ].map((needle) => needle.toLowerCase());
    const leaking = scannedStrings(payloads.all).filter((value) =>
      forbidden.some((needle) => value.toLowerCase().includes(needle)),
    );
    expect(leaking).toEqual([]);
    expect(values.filter((value) => Number(value) === Number(cepDigits))).toEqual([]);
    expect(keys.filter((key) => /^(address|cep|street|number|neighborhood)$/i.test(key))).toEqual(
      [],
    );
  });

  it("public payloads carry no e-mail", async () => {
    // Positive control: both patients' e-mail was accepted and stored.
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ email: string | null }>(
        "select email from patient where full_name = $1",
        [PATIENT.fullName],
      );
      expect(rows.map((row) => row.email)).toEqual([EMAIL, EMAIL]);
    } finally {
      await client.end();
    }

    const [localPart = "", domain = ""] = EMAIL.split("@");
    const leaking = scannedStrings(payloads.all).filter((value) =>
      [localPart, domain, "@"].some((needle) => value.toLowerCase().includes(needle)),
    );
    expect(leaking).toEqual([]);
    expect(leaves(payloads.all).keys.filter((key) => /e-?mail/i.test(key))).toEqual([]);
  });

  it("never stores the CPF in plaintext", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const columns = await client.query<{
        table_schema: string;
        table_name: string;
        column_name: string;
        data_type: string;
      }>(
        `select c.table_schema, c.table_name, c.column_name, c.data_type
           from information_schema.columns c
           join information_schema.tables t
             on t.table_schema = c.table_schema and t.table_name = c.table_name
          where t.table_type = 'BASE TABLE'
            and c.table_schema not in ('pg_catalog', 'information_schema')
            and c.data_type in ('text', 'character varying', 'bytea')`,
      );
      const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
      const cpfBytes = Buffer.from(CPF, "utf8");
      const scanned = new Set<string>();
      const found: string[] = [];
      let sawFullName = false;

      for (const column of columns.rows) {
        const where = `${column.table_schema}.${column.table_name}.${column.column_name}`;
        const { rows } = await client.query<{ value: string | Buffer }>(
          `select ${quote(column.column_name)} as value
             from ${quote(column.table_schema)}.${quote(column.table_name)}
            where ${quote(column.column_name)} is not null`,
        );
        scanned.add(where);
        for (const { value } of rows) {
          if (Buffer.isBuffer(value)) {
            if (value.includes(cpfBytes)) found.push(`${where} (bytes)`);
          } else {
            if (value.includes(CPF) || value.includes(PATIENT.cpf)) found.push(`${where} (text)`);
            if (value === PATIENT.fullName) sawFullName = true;
          }
        }
      }

      // The scan reaches the patient's columns and reads their data (positive control).
      expect(scanned).toContain("public.patient.cpf_ciphertext");
      expect(scanned).toContain("public.patient.cpf_hmac");
      expect(sawFullName).toBe(true);
      expect(found).toEqual([]);
    } finally {
      await client.end();
    }
  });
});
