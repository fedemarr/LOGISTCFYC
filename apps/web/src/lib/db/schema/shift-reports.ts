import { pgTable, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { driverShifts } from "./driver-shifts";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * Aviso de avance del chofer durante un turno (FYM). Cada 2-3 h el chofer
 * reporta en qué paquete va — con esto el admin sabe el progreso sin
 * intervenir. La hora de cada reporte compara contra `REPORT_INTERVAL_HOURS`
 * para saber si está al día o vencido.
 *
 * `orgId` está denormalizado (se podría derivar via `shiftId` ->
 * `driver_shifts.org_id`) para que la policy de RLS de esta tabla no
 * necesite un join — mismo patrón que el resto de las tablas de FYM
 * (`zones`, `driver_shifts`, `zone_alerts`).
 */
export const shiftReports = pgTable("shift_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  shiftId: uuid("shift_id")
    .notNull()
    .references(() => driverShifts.id),
  driverId: uuid("driver_id")
    .notNull()
    .references(() => users.id),
  /** Nº de paquete en el que va (progreso acumulado). */
  packagesDone: integer("packages_done").notNull(),
  note: text("note"),
  reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shiftReportsToSelect = {
  id: shiftReports.id,
  orgId: shiftReports.orgId,
  shiftId: shiftReports.shiftId,
  driverId: shiftReports.driverId,
  packagesDone: shiftReports.packagesDone,
  note: shiftReports.note,
  reportedAt: shiftReports.reportedAt,
} as const;

export type ShiftReport = typeof shiftReports.$inferSelect;
export type NewShiftReport = typeof shiftReports.$inferInsert;
