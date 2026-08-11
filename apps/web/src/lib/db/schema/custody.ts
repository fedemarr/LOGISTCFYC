import {
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { custodyMethodEnum, custodyStatusEnum } from "./enums";
import { organizations } from "./organizations";
import { routes } from "./routes";
import { containers } from "./containers";
import { users } from "./users";

export const custodyTransfers = pgTable("custody_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  routeId: uuid("route_id")
    .notNull()
    .references(() => routes.id),
  containerId: uuid("container_id").references(() => containers.id),
  fromUserId: uuid("from_user_id").references(() => users.id),
  toUserId: uuid("to_user_id")
    .notNull()
    .references(() => users.id),
  expectedCount: integer("expected_count").notNull(),
  countedCount: integer("counted_count"),
  method: custodyMethodEnum("method").notNull().default("COUNT"),
  status: custodyStatusEnum("status").notNull().default("OK"),
  discrepancyNotes: text("discrepancy_notes"),
  resolvedBy: uuid("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  overrideReason: text("override_reason"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  transferredAt: timestamp("transferred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
