import {
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Caché de la matriz de distancias/tiempos reales por calle (Google Routes
 * API, §8 etapa 2) — mismo criterio que `geocode_cache`: sin `org_id` a
 * propósito, se comparte entre organizaciones (el mismo par de coordenadas
 * da la misma distancia real sin importar quién pregunte). Ver
 * `supabase/migrations/0007_route_matrix_cache.sql`.
 */
export const routeMatrixCache = pgTable("route_matrix_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  pairHash: text("pair_hash").notNull().unique(),
  originLat: doublePrecision("origin_lat").notNull(),
  originLng: doublePrecision("origin_lng").notNull(),
  destLat: doublePrecision("dest_lat").notNull(),
  destLng: doublePrecision("dest_lng").notNull(),
  distanceM: doublePrecision("distance_m"),
  durationS: integer("duration_s"),
  provider: text("provider").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
