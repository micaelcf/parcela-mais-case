import { describe, expect, it } from "vite-plus/test";

import type { OfferView } from "#/server/modules/consultation/consultation.dto";

import { groupOffersByLender, sortOffers } from "./sort-offers";

function offer(
  lender: OfferView["lender"],
  termMonths: number,
  installmentCents: number,
  totalCents: number,
): OfferView {
  return {
    id: `${lender}-${termMonths}`,
    lender,
    approvedCents: 1_000_000,
    requestedCents: 1_000_000,
    approvedBelowRequested: false,
    monthlyRate: "0.024900",
    termMonths,
    installmentCents,
    totalCents,
  };
}

/** API order (lender, then term), with ties on installment and on total across lenders. */
const OFFERS: OfferView[] = [
  offer("ALFA", 6, 181_000, 1_086_000),
  offer("ALFA", 12, 97_428, 1_169_136),
  offer("BETA", 12, 56_000, 672_000),
  offer("BETA", 24, 30_000, 720_000),
  offer("GAMA", 10, 97_428, 974_280),
  offer("DELTA", 24, 30_000, 720_000),
  offer("DELTA", 12, 30_000, 360_000),
];

const ids = (offers: OfferView[]) => offers.map((item) => item.id);

describe("sortOffers", () => {
  it("sorts by lowest installment", () => {
    expect(ids(sortOffers(OFFERS, "installment"))).toEqual([
      "BETA-24",
      "DELTA-12",
      "DELTA-24",
      "BETA-12",
      "ALFA-12",
      "GAMA-10",
      "ALFA-6",
    ]);
  });

  it("sorts by lowest total", () => {
    expect(ids(sortOffers(OFFERS, "total"))).toEqual([
      "DELTA-12",
      "BETA-12",
      "BETA-24",
      "DELTA-24",
      "GAMA-10",
      "ALFA-6",
      "ALFA-12",
    ]);
  });

  it("returns a copy and leaves the API order untouched", () => {
    const before = ids(OFFERS);
    sortOffers(OFFERS, "total");
    expect(ids(OFFERS)).toEqual(before);
  });
});

describe("groupOffersByLender", () => {
  const groups = (sort: "installment" | "total") =>
    groupOffersByLender(OFFERS, sort).map((group) => [group.lender, ids(group.offers)]);

  it("orders groups by their lowest installment, ties in lender order", () => {
    expect(groups("installment")).toEqual([
      ["BETA", ["BETA-24", "BETA-12"]],
      ["DELTA", ["DELTA-12", "DELTA-24"]],
      ["ALFA", ["ALFA-12", "ALFA-6"]],
      ["GAMA", ["GAMA-10"]],
    ]);
  });

  it("orders groups by their lowest total", () => {
    expect(groups("total")).toEqual([
      ["DELTA", ["DELTA-12", "DELTA-24"]],
      ["BETA", ["BETA-12", "BETA-24"]],
      ["GAMA", ["GAMA-10"]],
      ["ALFA", ["ALFA-6", "ALFA-12"]],
    ]);
  });

  it("returns no groups without offers", () => {
    expect(groupOffersByLender([], "installment")).toEqual([]);
  });
});
