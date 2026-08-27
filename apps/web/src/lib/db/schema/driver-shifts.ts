import { pgTable, integer, text, timestamp, uuid, date } from "drizzle-orm/pg-core";
import { shiftStatusEnum } from "./enums";
import { organizations } from "./organizations";
import { users } from "./users";
import { zones } from "./zones";

/**
 * Turno de un chofer en un día (FYM). El chofer arranca el turno desde el
 * depósito: entra la cantidad de paquetes con la que sale, la zona que le
 * tocó, y se activa el GPS. Durante el turno reporta avances cada 2-3 h
 * (`shift_reports`). Al terminar carga cuántos paquetes quedaron sin
 * repartir y la hora de fin.
 */
export const driverShifts = pgTable("driver_shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  driverId: uuid("driver_id")
    .notNull()
    .references(() => users.id),
  zoneId: uuid("zone_id")
    .notNull()
    .references(() => zones.id),
  /** Fecha del día de reparto (timezone de la org). */
  shiftDate: date("shift_date").notNull(),
  /** Cantidad de paquetes con la que salió del depósito. */
  packageCount: integer("package_count").notNull(),
  status: shiftStatusEnum("status").notNull().default("ACTIVE"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  /** Paquetes que quedaron sin repartir al cerrar el turno. */
  undeliveredCount: integer("undelivered_count"),
  notes: text("notes"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const driverShiftsToSelect = {
  id: driverShifts.id,
  orgId: driverShifts.orgId,
  driverId: driverShifts.driverId,
  zoneId: driverShifts.zoneId,
  shiftDate: driverShifts.shiftDate,
  packageCount: driverShifts.packageCount,
  status: driverShifts.status,
  startedAt: driverShifts.startedAt,
  endedAt: driverShifts.endedAt,
  undeliveredCount: driverShifts.undeliveredCount,
  notes: driverShifts.notes,
} as const;

export type DriverShift = typeof driverShifts.$inferSelect;
export type NewDriverShift = typeof driverShifts.$inferInsert;
