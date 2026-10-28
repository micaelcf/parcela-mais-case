import { randomInt } from "node:crypto";

import type { Address } from "#/lib/address/address";
import { cpfCheckDigits } from "#/lib/cpf/cpf";

import { PAULISTA } from "./address-lookup";

/** A signup applicant. Every one gets a fresh CPF, so the per-patient cap never trips across tests. */
export type Patient = {
  firstName: string;
  fullName: string;
  /** Lowercase letters unique to this patient, part of its name: what explorer searches look for. */
  token: string;
  /** 11 digits. */
  cpf: string;
  /** `000.000.000-00`. */
  cpfFormatted: string;
  /** `YYYY-MM-DD`. */
  birthdate: string;
  /** What the signup sends (the CEP as digits): the lookup fills all but the number. */
  address: Address;
  /** 11 digits. */
  phone: string;
  /** Optional: absent, the signup leaves the e-mail blank. */
  email?: string;
  monthlyIncomeCents: number;
  treatmentAmountCents: number;
};

// No vowels: a random token can never spell a word a spec looks for ("renda", "idade"…).
const TOKEN_LETTERS = "bcdfghjklmnpqrstvwxz";

/** A valid CPF that no other test uses: 9 random digits (never all equal) plus their check digits. */
export function uniqueCpf(): string {
  for (;;) {
    const base = Array.from({ length: 9 }, () => randomInt(10)).join("");
    if (!/^(\d)\1{8}$/.test(base)) return `${base}${cpfCheckDigits(base)}`;
  }
}

export function formatCpf(digits: string): string {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/**
 * A `YYYY-MM-DD` birthdate whose holder is `age` today: born `age` years and 30 days ago, so the
 * birthday is a month past and a time-zone shift between browser and server can't change the age.
 */
export function birthdateForAge(age: number, today = new Date()): string {
  const born = new Date(today);
  born.setFullYear(born.getFullYear() - age);
  born.setDate(born.getDate() - 30);
  const month = String(born.getMonth() + 1).padStart(2, "0");
  const day = String(born.getDate()).padStart(2, "0");
  return `${born.getFullYear()}-${month}-${day}`;
}

const CENTS_INPUT = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Cents as typed in a currency input: `1000000` → `"10.000,00"`. */
export function centsInput(cents: number): string {
  return CENTS_INPUT.format(cents / 100);
}

/** `YYYY-MM-DD` → `dd/mm/aaaa`, as typed into a date field. */
export function dateText(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * A 40-year-old earning R$ 5.000,00 who asks for R$ 10.000,00: every lender's own rule approves
 * (Alfa 10 × income ≥ amount, Gama ≥ 25 years and ≤ R$ 20.000), Beta at 60 %.
 */
export function newPatient(overrides: Partial<Omit<Patient, "cpfFormatted">> = {}): Patient {
  const token = Array.from(
    { length: 10 },
    () => TOKEN_LETTERS[randomInt(TOKEN_LETTERS.length)],
  ).join("");
  const cpf = overrides.cpf ?? uniqueCpf();
  return {
    firstName: "Lucia",
    fullName: `Lucia ${token} Teste`,
    token,
    birthdate: birthdateForAge(40),
    phone: "11987654321",
    address: { ...PAULISTA, number: "1578" },
    monthlyIncomeCents: 500_000,
    treatmentAmountCents: 1_000_000,
    ...overrides,
    cpf,
    cpfFormatted: formatCpf(cpf),
  };
}
