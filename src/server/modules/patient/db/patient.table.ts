import { bytea, date, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { BR_STATES } from "#/lib/address/address";
import { uuidv7 } from "#/server/infra/db/uuid";

/** One row per person, keyed by the CPF blind index; the CPF itself is only ever ciphertext. */
export const patient = pgTable("patient", {
  id: uuid("id").primaryKey().$defaultFn(uuidv7),
  cpfHmac: bytea("cpf_hmac").notNull().unique(),
  cpfCiphertext: bytea("cpf_ciphertext").notNull(),
  cpfKeyVersion: smallint("cpf_key_version").notNull(),
  fullName: text("full_name").notNull(),
  birthdate: date("birthdate", { mode: "string" }).notNull(),
  phone: text("phone").notNull(),
  /** The latest address sent, normalised (all null for patients saved before addresses existed). */
  addressCep: text("address_cep"),
  addressStreet: text("address_street"),
  addressNumber: text("address_number"),
  addressComplement: text("address_complement"),
  addressNeighborhood: text("address_neighborhood"),
  addressCity: text("address_city"),
  addressState: text("address_state", { enum: BR_STATES }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
