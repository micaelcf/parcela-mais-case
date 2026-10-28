import type { LenderCode } from "#/lib/enums";
import type { DbOrTx, Tx } from "#/server/infra/db/client";

import { type OfferRow, offerRepository } from "./offer.repository";
import { priceInstallment } from "./price";

export type ApprovedAttempt = {
  attemptId: string;
  consultationId: string;
  lender: LenderCode;
  requestedCents: number;
  approvedCents: number;
  monthlyRate: string;
  termsMonths: readonly number[];
};

export const pricingService = {
  /** One Tabela Price offer per approved term, inside the attempt's settle TX. */
  async createOffers(tx: Tx, approved: ApprovedAttempt): Promise<OfferRow[]> {
    const terms = [...new Set(approved.termsMonths)];
    return offerRepository.insertMany(
      tx,
      terms.map((termMonths) => ({
        attemptId: approved.attemptId,
        consultationId: approved.consultationId,
        lender: approved.lender,
        approvedCents: approved.approvedCents,
        requestedCents: approved.requestedCents,
        monthlyRate: approved.monthlyRate,
        termMonths,
        ...priceInstallment({
          principalCents: approved.approvedCents,
          monthlyRate: approved.monthlyRate,
          termMonths,
        }),
      })),
    );
  },

  findOffer(executor: DbOrTx, offerId: string, consultationId: string) {
    return offerRepository.findInConsultation(executor, offerId, consultationId);
  },
};
