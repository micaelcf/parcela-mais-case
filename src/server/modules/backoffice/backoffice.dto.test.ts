import { describe, expect, it } from "vite-plus/test";

import { type ConsultationDetailRows, toConsultationDetail } from "./backoffice.dto";

const AT = new Date("2026-10-28T12:00:00.000Z");

const NO_ADDRESS = {
  addressCep: null,
  addressStreet: null,
  addressNumber: null,
  addressComplement: null,
  addressNeighborhood: null,
  addressCity: null,
  addressState: null,
};

function rows(patient: Partial<ConsultationDetailRows["patient"]>): ConsultationDetailRows {
  return {
    id: "0192f0a0-0000-7000-8000-000000000001",
    quoteStatus: "QUOTING",
    simulationScenario: "NORMAL",
    monthlyIncomeCents: 1_000_000,
    treatmentAmountCents: 1_000_000,
    birthdate: "1986-01-01",
    ageYears: 40,
    createdAt: AT,
    deadlineAt: AT,
    settledAt: null,
    chosenOfferId: null,
    chosenAt: null,
    patient: {
      id: "0192f0a0-0000-7000-8000-000000000002",
      fullName: "Maria da Silva",
      birthdate: "1986-01-01",
      phone: "11987654321",
      ...NO_ADDRESS,
      createdAt: AT,
      updatedAt: AT,
      ...patient,
    },
    attempts: [],
    offers: [],
  };
}

describe("toConsultationDetail", () => {
  it("shows no address for a patient saved before addresses existed", () => {
    expect(toConsultationDetail(rows({}), "52998224725").patient.address).toBeNull();
  });

  it("maps the stored address columns", () => {
    const detail = toConsultationDetail(
      rows({
        addressCep: "01310100",
        addressStreet: "Avenida Paulista",
        addressNumber: "1578",
        addressNeighborhood: "Bela Vista",
        addressCity: "São Paulo",
        addressState: "SP",
      }),
      "52998224725",
    );

    expect(detail.patient.address).toEqual({
      cep: "01310100",
      street: "Avenida Paulista",
      number: "1578",
      complement: null,
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    });
  });
});
