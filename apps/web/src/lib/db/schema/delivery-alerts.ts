import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { deliveryAlertReasonEnum, deliveryAlertStatusEnum } from "./enums";
import { organizations } from "./organizations";
import { driverShifts } from "./driver-shifts";
import { users } from "./users";

/**
 * Alerta de ENTREGA (FYM) — incidente del turno reportado por el chofer
 * desde la PWA: un paquete que no pudo entregar porque no estaba el
 * destinatario, porque lo rechazó, o por otro motivo. El campo clave es
 * `contactPhone`: el teléfono del destinatario (si lo tiene) para que el
 * control llame DIRECTAMENTE en vez de que el chofer tenga que frenar a
 * llamar ("el conductor puede seguir manejando" — pedido de Fede).
 *
 * NO es una alerta de geocerca (`zoneAlerts`): ese motor exige `zone_id`
 * + `distance_outside_m` y lo dispara el sistema; acá el dato de fondo es
 * otro y lo reporta el chofer. Fire-and-forget: no bloquea ni pide
 * confirmación.
 */
export const deliveryAlerts = pgTable("delivery_alerts", {
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
  reason: deliveryAlertReasonEnum("reason").notNull(),
  /** Teléfono de contacto del destinatario — el que llama control. */
  contactPhone: text("contact_phone"),
  note: text("note"),
  status: deliveryAlertStatusEnum("status").notNull().default("OPEN"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const deliveryAlertsToSelect = {
  id: deliveryAlerts.id,
  orgId: deliveryAlerts.orgId,
  shiftId: deliveryAlerts.shiftId,
  driverId: deliveryAlerts.driverId,
  reason: deliveryAlerts.reason,
  contactPhone: deliveryAlerts.contactPhone,
  note: deliveryAlerts.note,
  status: deliveryAlerts.status,
  createdAt: deliveryAlerts.createdAt,
  resolvedAt: deliveryAlerts.resolvedAt,
} as const;

export type DeliveryAlert = typeof deliveryAlerts.$inferSelect;
export type NewDeliveryAlert = typeof deliveryAlerts.$inferInsert;
