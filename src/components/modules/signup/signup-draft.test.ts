import { describe, expect, it } from "vite-plus/test";

import {
  readSignupDraft,
  SIGNUP_DRAFT_KEY,
  SIGNUP_DRAFT_TTL_MS,
  type SignupDraft,
  writeSignupDraft,
} from "./signup-draft";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const values: SignupDraft["values"] = {
  fullName: "Ana Lima",
  cpf: "529.982.2",
  birthdate: "",
  cep: "01310-100",
  street: "Avenida Paulista",
  addressNumber: "1578",
  complement: "",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
  phone: "",
  email: "",
  monthlyIncome: "",
  treatmentAmount: "",
  simulationScenario: "NORMAL",
};
const cepLookup: SignupDraft["cepLookup"] = {
  cep: "01310100",
  result: {
    kind: "found",
    address: {
      cep: "01310100",
      street: "Avenida Paulista",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    },
  },
};

describe("signup draft", () => {
  it("restores half-typed values and the CEP lookup within 30 minutes of the last edit", () => {
    const storage = memoryStorage();
    writeSignupDraft(storage, { values, cepLookup, editedAt: 1_000 });

    const draft = readSignupDraft(storage, 1_000 + SIGNUP_DRAFT_TTL_MS);
    expect(draft?.values).toEqual(values);
    expect(draft?.cepLookup).toEqual(cepLookup);
  });

  it("drops and removes a draft last edited more than 30 minutes ago", () => {
    const storage = memoryStorage();
    writeSignupDraft(storage, { values, cepLookup: null, editedAt: 1_000 });

    expect(readSignupDraft(storage, 1_001 + SIGNUP_DRAFT_TTL_MS)).toBeNull();
    expect(storage.items.has(SIGNUP_DRAFT_KEY)).toBe(false);
  });

  it("drops and removes an unreadable or foreign-shaped draft", () => {
    for (const raw of [
      "{not json",
      JSON.stringify({ version: 2, editedAt: 0, values, cepLookup: null }),
      JSON.stringify({ version: 1, editedAt: 0, values: { ...values, cpf: 52998224725 } }),
      JSON.stringify({ version: 1, editedAt: 0, values: { ...values, simulationScenario: "X" } }),
    ]) {
      const storage = memoryStorage();
      storage.setItem(SIGNUP_DRAFT_KEY, raw);

      expect(readSignupDraft(storage, 0), raw).toBeNull();
      expect(storage.items.has(SIGNUP_DRAFT_KEY), raw).toBe(false);
    }
  });
});
