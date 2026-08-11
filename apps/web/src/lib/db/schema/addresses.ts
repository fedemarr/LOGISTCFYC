import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { geocodeAccuracyEnum } from "./enums";
import { organizations } from "./organizations";

/**
 * Memoria de direcciones (PROMPT-MAESTRO §2). `geom` (geography(Point,4326))
 * y su índice GIST se agregan en la migración de PostGIS como columna
 * generada a partir de (lat, lng) — no se modelan acá porque Drizzle no
 * tiene un tipo `geography` nativo maduro; ver
 * supabase/migrations/*_postgis.sql y docs/DECISIONES.md ADR-013.
 */
export const knownAddresses = pgTable("known_addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  normalizedHash: text("normalized_hash").notNull().unique(),
  rawText: text("raw_text").notNull(),
  street: text("street"),
  number: text("number"),
  floor: text("floor"),
  apartment: text("apartment"),
  locality: text("locality"),
  municipality: text("municipality"),
  province: text("province"),
  postalCode: text("postal_code"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  geocodeSource: text("geocode_source"),
  geocodeAccuracy: geocodeAccuracyEnum("geocode_accuracy").notNull().default("MANUAL"),
  operationalNotes: text("operational_notes"),
  deliverySuccessCount: integer("delivery_success_count").notNull().default(0),
  deliveryFailCount: integer("delivery_fail_count").notNull().default(0),
  verifiedByDriver: boolean("verified_by_driver").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/**
 * Caché del proveedor de geocoding — separado del catálogo a propósito
 * (guarda la respuesta cruda para reprocesar sin volver a pagar). No lleva
 * `org_id`: el mismo `query_hash` (dirección normalizada) devuelve la misma
 * coordenada sin importar qué organización pregunte, así el caché se
 * comparte entre orgs futuras.
 */
export const geocodeCache = pgTable("geocode_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  queryHash: text("query_hash").notNull().unique(),
  provider: text("provider").notNull(),
  rawResponse: jsonb("raw_response").notNull(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  accuracy: geocodeAccuracyEnum("accuracy"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
