import { bytea, index, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { uuidv7 } from "#/server/infra/db/uuid";

/** One row per counted request on the throttled routes; purged after the IP window + 24 h. */
export const requestThrottle = pgTable(
  "request_throttle",
  {
    id: uuid("id").primaryKey().$defaultFn(uuidv7),
    ipHmac: bytea("ip_hmac").notNull(),
    route: text("route", {
      enum: ["consultation.create", "consultation.requote", "address.lookup"],
    }).notNull(),
    statusCode: smallint("status_code"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("request_throttle_ip_route_created_idx").on(table.ipHmac, table.route, table.createdAt),
    index("request_throttle_created_id_idx").on(table.createdAt, table.id),
  ],
);
