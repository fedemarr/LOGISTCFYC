import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/**
 * Zonas geográficas del sistema FYM. A cada zona le corresponde un círculo
 * (centro + radio en metros): si el chofer con turno activo en esa zona se
 * aleja más allá del radio, el motor de geocerca genera una alerta
 * `LEFT_ZONE` (el admin tiene registrado el teléfono del chofer para
 * llamarlo, pedido de Fede).
 */
export const zones = pgTable("zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  name: varchar("name", { length: 100 }).notNull(),
  /** Color de la zona en el mapa del panel. */
  colorHex: varchar("color_hex", { length: 7 }).notNull().default("#3b82f6"),
  centerLat: doublePrecision("center_lat").notNull(),
  centerLng: doublePrecision("center_lng").notNull(),
  /** Radio de la geocerca, en metros. */
  radiusM: integer("radius_m").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const zonesToSelect = {
  id: zones.id,
  orgId: zones.orgId,
  name: zones.name,
  colorHex: zones.colorHex,
  centerLat: zones.centerLat,
  centerLng: zones.centerLng,
  radiusM: zones.radiusM,
  isActive: zones.isActive,
  createdAt: zones.createdAt,
  updatedAt: zones.updatedAt,
} as const;

export type Zone = typeof zones.$inferSelect;
export type NewZone = typeof zones.$inferInsert;
