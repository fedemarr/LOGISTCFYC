import {
  boolean,
  doublePrecision,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { deliveryOutcomeEnum } from "./enums";
import { organizations } from "./organizations";
import { packages } from "./packages";
import { routes } from "./routes";
import { users } from "./users";
import { vehicles } from "./vehicles";

/**
 * §11: NUNCA el DNI completo — solo últimos 4 dígitos + hash con salt.
 * NUNCA foto del documento. Ver docs/DECISIONES.md y §11.
 */
export const deliveries = pgTable("deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  packageId: uuid("package_id")
    .notNull()
    .unique()
    .references(() => packages.id),
  routeId: uuid("route_id").references(() => routes.id),
  driverId: uuid("driver_id").references(() => users.id),
  vehicleId: uuid("vehicle_id").references(() => vehicles.id),
  outcome: deliveryOutcomeEnum("outcome").notNull(),
  receiverName: text("receiver_name"),
  receiverRelationship: text("receiver_relationship"),
  documentLast4: text("document_last4"),
  documentHash: text("document_hash"),
  signatureUrl: text("signature_url"),
  photoUrls: text("photo_urls").array().notNull().default([]),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  gpsAccuracyM: doublePrecision("gps_accuracy_m"),
  /** Control anti-fraude (§9.5): >150 m exige confirmación explícita. */
  distanceFromTargetM: doublePrecision("distance_from_target_m"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  deviceId: text("device_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  offlineCreated: boolean("offline_created").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
