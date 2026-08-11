import {
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { incidentReasonEnum, incidentResolutionEnum, incidentStatusEnum } from "./enums";
import { organizations } from "./organizations";
import { packages } from "./packages";
import { routes } from "./routes";
import { users } from "./users";

export const incidents = pgTable("incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  packageId: uuid("package_id").references(() => packages.id),
  routeId: uuid("route_id").references(() => routes.id),
  driverId: uuid("driver_id").references(() => users.id),
  reason: incidentReasonEnum("reason").notNull(),
  description: text("description"),
  photoUrls: text("photo_urls").array().notNull().default([]),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  status: incidentStatusEnum("status").notNull().default("OPEN"),
  resolution: incidentResolutionEnum("resolution"),
  resolvedBy: uuid("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  /** SLA interno de 10 min (§9.7): tiempo hasta la resolución, en segundos. */
  responseTimeS: integer("response_time_s"),
  proposedAddressText: text("proposed_address_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
