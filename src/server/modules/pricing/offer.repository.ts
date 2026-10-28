import { and, eq } from "drizzle-orm";

import type { DbOrTx, Tx } from "#/server/infra/db/client";
import { offer } from "#/server/modules/pricing/db/offer.table";

export type OfferRow = typeof offer.$inferSelect;
export type NewOffer = typeof offer.$inferInsert;

/** Offers are immutable: this repository only inserts and reads. */
export const offerRepository = {
  async insertMany(tx: Tx, rows: NewOffer[]): Promise<OfferRow[]> {
    if (rows.length === 0) return [];
    return tx.insert(offer).values(rows).returning();
  },

  async findInConsultation(
    executor: DbOrTx,
    offerId: string,
    consultationId: string,
  ): Promise<OfferRow | undefined> {
    const [row] = await executor
      .select()
      .from(offer)
      .where(and(eq(offer.id, offerId), eq(offer.consultationId, consultationId)));
    return row;
  },
};
