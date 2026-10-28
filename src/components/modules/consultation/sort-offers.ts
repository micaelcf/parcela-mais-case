import { LENDER_CODES } from "#/lib/enums";
import type { OfferView } from "#/server/modules/consultation/consultation.dto";

export const OFFER_SORTS = ["installment", "total"] as const;
export type OfferSort = (typeof OFFER_SORTS)[number];

const SORT_KEY: Record<OfferSort, (offer: OfferView) => number> = {
  installment: (offer) => offer.installmentCents,
  total: (offer) => offer.totalCents,
};

/** A sorted copy of the API's offers: by the chosen amount ascending, then lender order, then term. */
export function sortOffers(offers: readonly OfferView[], sort: OfferSort): OfferView[] {
  const key = SORT_KEY[sort];
  return [...offers].sort(
    (a, b) =>
      key(a) - key(b) ||
      LENDER_CODES.indexOf(a.lender) - LENDER_CODES.indexOf(b.lender) ||
      a.termMonths - b.termMonths,
  );
}
