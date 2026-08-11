import { boolean, doublePrecision, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";
import { routes } from "./routes";

/**
 * PARTICIONADA POR MES sobre `recorded_at` (§7) — la partición real se crea
 * a mano en la migración SQL (`supabase/migrations/*_partitioning.sql`),
 * Drizzle no tiene soporte declarativo de `PARTITION BY`. La PK real a
 * nivel Postgres es compuesta `(id, recorded_at)` porque toda tabla
 * particionada por rango debe incluir la columna de partición en su PK;
 * acá se declara `id` solo por comodidad del query builder de Drizzle.
 * Retención: 90 días, después se agrega y se purga (FASE 13).
 */
export const driverLocations = pgTable("driver_locations", {
  id: uuid("id").defaultRandom().notNull(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  driverId: uuid("driver_id")
    .notNull()
    .references(() => users.id),
  routeId: uuid("route_id").references(() => routes.id),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  accuracyM: doublePrecision("accuracy_m"),
  speedMps: doublePrecision("speed_mps"),
  heading: doublePrecision("heading"),
  batteryLevel: doublePrecision("battery_level"),
  isMoving: boolean("is_moving"),
  /** Hora del dispositivo — puede llegar minutos/horas después por offline. */
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  /** Hora del servidor. Nunca confundir con `recordedAt` (§10). */
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
