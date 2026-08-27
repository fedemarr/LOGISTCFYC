import { boolean, doublePrecision, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";
import { driverShifts } from "./driver-shifts";

/**
 * Ubicación GPS del chofer, PARTE del sistema de control FYM.
 *
 * Particionada por mes sobre `recorded_at` — la partición se crea a mano en
 * la migración SQL, Drizzle no tiene soporte declarativo de `PARTITION BY`.
 * Retención: 90 días, después se agrega y se purga.
 */
export const driverLocations = pgTable("driver_locations", {
  id: uuid("id").defaultRandom().notNull(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  driverId: uuid("driver_id")
    .notNull()
    .references(() => users.id),
  shiftId: uuid("shift_id").references(() => driverShifts.id),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  accuracyM: doublePrecision("accuracy_m"),
  speedMps: doublePrecision("speed_mps"),
  heading: doublePrecision("heading"),
  batteryLevel: doublePrecision("battery_level"),
  isMoving: boolean("is_moving"),
  /** Hora del dispositivo — puede llegar minutos/horas después por offline. */
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  /** Hora del servidor. Nunca confundir con `recordedAt`. */
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
