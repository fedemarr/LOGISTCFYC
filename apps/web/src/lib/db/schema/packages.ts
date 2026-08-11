import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  destinationConfidenceEnum,
  destinationSourceEnum,
  packageStatusEnum,
  routeStopStatusEnum,
} from "./enums";
import { organizations } from "./organizations";
import { clients } from "./clients";
import { operations } from "./operations";
import { knownAddresses } from "./addresses";
import { routes } from "./routes";

/**
 * REGLA DE DISEÑO CRÍTICA (§7): `bulk_number` es la identidad física del
 * paquete dentro de la ruta — se imprime en la etiqueta y NUNCA cambia una
 * vez aprobada la ruta. La posición en la secuencia de entrega vive en
 * `route_stops.sequence`, que sí se recalcula. No confundir los dos.
 */
export const packages = pgTable(
  "packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    clientId: uuid("client_id").references(() => clients.id),
    operationId: uuid("operation_id").references(() => operations.id),
    trackingCode: text("tracking_code"),
    internalCode: text("internal_code").notNull().unique(),
    status: packageStatusEnum("status").notNull().default("PENDIENTE_RESOLUCION"),
    recipientName: text("recipient_name"),
    recipientPhone: text("recipient_phone"),
    recipientDocumentHash: text("recipient_document_hash"),
    addressId: uuid("address_id").references(() => knownAddresses.id),
    rawAddressText: text("raw_address_text"),
    destinationSource: destinationSourceEnum("destination_source"),
    destinationConfidence: destinationConfidenceEnum("destination_confidence"),
    labelPhotoUrl: text("label_photo_url"),
    weightKg: doublePrecision("weight_kg"),
    dimensions: jsonb("dimensions"),
    declaredValue: numeric("declared_value"),
    requiresPhoto: boolean("requires_photo").notNull().default(false),
    requiresDocument: boolean("requires_document").notNull().default(false),
    priority: integer("priority").notNull().default(0),
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    routeId: uuid("route_id").references(() => routes.id),
    bulkNumber: integer("bulk_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("packages_org_id_status_idx").on(table.orgId, table.status),
    index("packages_operation_id_idx").on(table.operationId),
    index("packages_route_id_idx").on(table.routeId),
    index("packages_tracking_code_idx").on(table.trackingCode),
  ],
);

export const routeStops = pgTable(
  "route_stops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id),
    /** Posición en la secuencia de entrega — recalculable, ver nota en `packages`. */
    sequence: integer("sequence").notNull(),
    plannedArrival: timestamp("planned_arrival", { withTimezone: true }),
    actualArrival: timestamp("actual_arrival", { withTimezone: true }),
    distanceFromPrevM: doublePrecision("distance_from_prev_m"),
    durationFromPrevS: integer("duration_from_prev_s"),
    status: routeStopStatusEnum("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("route_stops_route_id_idx").on(table.routeId),
    index("route_stops_package_id_idx").on(table.packageId),
    unique("route_stops_route_id_package_id_key").on(table.routeId, table.packageId),
  ],
);
