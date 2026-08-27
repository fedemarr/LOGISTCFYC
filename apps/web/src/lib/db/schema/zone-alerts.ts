import { integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { zoneAlertStatusEnum, zoneAlertTypeEnum } from "./enums";
import { organizations } from "./organizations";
import { driverShifts } from "./driver-shifts";
import { users } from "./users";
import { zones } from "./zones";

/**
 * Alerta de geocerca (FYM). Se crea cuando el motor de geocerca detecta que
 * un chofer con turno activo salió del radio de su zona (`LEFT_ZONE`). El
 * admin la ve en el panel junto con el teléfono del chofer para llamarlo.
 */
export const zoneAlerts = pgTable("zone_alerts", {
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
  zoneId: uuid("zone_id")
    .notNull()
    .references(() => zones.id),
  alertType: zoneAlertTypeEnum("alert_type").notNull(),
  status: zoneAlertStatusEnum("status").notNull().default("OPEN"),
  /** Distancia (m) a la que estaba el chofer afuera de la geocerca. */
  distanceOutsideM: integer("distance_outside_m"),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const zoneAlertsToSelect = {
  id: zoneAlerts.id,
  orgId: zoneAlerts.orgId,
  shiftId: zoneAlerts.shiftId,
  driverId: zoneAlerts.driverId,
  zoneId: zoneAlerts.zoneId,
  alertType: zoneAlerts.alertType,
  status: zoneAlerts.status,
  distanceOutsideM: zoneAlerts.distanceOutsideM,
  triggeredAt: zoneAlerts.triggeredAt,
  resolvedAt: zoneAlerts.resolvedAt,
} as const;

export type ZoneAlert = typeof zoneAlerts.$inferSelect;
export type NewZoneAlert = typeof zoneAlerts.$inferInsert;
