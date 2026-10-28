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

export type LenderOfferGroup = { lender: OfferView["lender"]; offers: OfferView[] };

/**
 * The offers grouped by lender, each group sorted like `sortOffers` and the groups ordered by
 * their best offer (ties in lender order).
 */
export function groupOffersByLender(
  offers: readonly OfferView[],
  sort: OfferSort,
): LenderOfferGroup[] {
  const groups = new Map<OfferView["lender"], OfferView[]>();
  for (const offer of sortOffers(offers, sort)) {
    const group = groups.get(offer.lender);
    if (group) group.push(offer);
    else groups.set(offer.lender, [offer]);
  }
  return [...groups].map(([lender, grouped]) => ({ lender, offers: grouped }));
}
