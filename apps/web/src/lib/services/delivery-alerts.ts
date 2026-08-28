import { and, desc, eq } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { deliveryAlerts, driverShifts, users, zones } from "@/lib/db/schema";
import { logDomainEvent } from "@/lib/services/events";
import { getActiveShiftForDriver } from "@/lib/services/shifts";
import type { DriverAuthContext } from "@/lib/services/driver-qr";
import type { ActorContext } from "@/lib/services/zones";
import type { DeliveryAlertReason, DeliveryAlertStatus } from "@fym/shared";

/**
 * ALERTAS DE ENTREGA (FYM) — incidentes de turno reportados por el chofer
 * desde la PWA (un paquete que no pudo entregar: no estaba el destinatario,
 * rechazó, otro). Son fire-and-forget: no piden confirmación ni frenan al
 * chofer. El admin/dispatcher las ve en una cola con el teléfono de contacto
 * para llamar él mismo.
 *
 * A diferencia de `zoneAlerts` (motor de geocerca, exige `zone_id` +
 * `distance_outside_m`), acá el dato de fondo es el motivo + teléfono de
 * contacto + nota y el creador es el chofer.
 */

export type { DeliveryAlertReason, DeliveryAlertStatus };

export interface DeliveryAlertInput {
  reason: DeliveryAlertReason;
  contactPhone?: string | null;
  note?: string | null;
}

/** Crea la alerta durante un turno activo. Si no hay turno activo, error —
 * reportar un problema de entrega sin turno no tiene sentido. */
export async function createDeliveryAlert(
  driver: DriverAuthContext,
  input: DeliveryAlertInput,
  log = logDomainEvent,
) {
  const active = await getActiveShiftForDriver(driver.userId, driver.orgId);
  if (!active) throw Errors.conflict("no hay un turno activo para reportar un problema");

  const now = new Date();
  const [alert] = await db
    .insert(deliveryAlerts)
    .values({
      orgId: driver.orgId,
      shiftId: active.shift.id,
      driverId: driver.userId,
      reason: input.reason,
      contactPhone: input.contactPhone?.trim() || null,
      note: input.note?.trim() || null,
      status: "OPEN",
      createdAt: now,
    })
    .returning();
  if (!alert) throw Errors.internal("no se pudo crear la alerta de entrega");

  await db.transaction(async (tx) => {
    await log(
      {
        orgId: driver.orgId,
        entityType: "ALERT",
        entityId: active.shift.id,
        eventType: "DELIVERY_ALERT_REPORTED",
        actorId: driver.userId,
        actorRole: "driver",
        toStatus: "OPEN",
        occurredAt: now,
        metadata: {
          alertId: alert.id,
          reason: alert.reason,
          contactPhone: alert.contactPhone ?? null,
        },
      },
      tx,
    );
  });

  return alert;
}

const deliveryAlertViewSelect = {
  id: deliveryAlerts.id,
  reason: deliveryAlerts.reason,
  contactPhone: deliveryAlerts.contactPhone,
  note: deliveryAlerts.note,
  status: deliveryAlerts.status,
  createdAt: deliveryAlerts.createdAt,
  resolvedAt: deliveryAlerts.resolvedAt,
  shift: {
    id: driverShifts.id,
    status: driverShifts.status,
    packageCount: driverShifts.packageCount,
  },
  zone: { id: zones.id, name: zones.name, colorHex: zones.colorHex },
  driver: {
    id: users.id,
    fullName: users.fullName,
    phone: users.phone,
  },
} as const;

export async function listDeliveryAlerts(orgId: string, status?: DeliveryAlertStatus) {
  return db
    .select(deliveryAlertViewSelect)
    .from(deliveryAlerts)
    .innerJoin(driverShifts, eq(driverShifts.id, deliveryAlerts.shiftId))
    .innerJoin(zones, eq(zones.id, driverShifts.zoneId))
    .innerJoin(users, eq(users.id, deliveryAlerts.driverId))
    .where(
      and(
        eq(deliveryAlerts.orgId, orgId),
        status ? eq(deliveryAlerts.status, status) : undefined,
      ),
    )
    .orderBy(desc(deliveryAlerts.createdAt));
}

/** Avanza el estado de una alerta a CONTACTED o RESOLVED desde el panel.
 * Idempotente: una alerta ya RESOLVED devuelve el estado sin tocar nada. */
export async function updateDeliveryAlert(
  orgId: string,
  alertId: string,
  status: Extract<DeliveryAlertStatus, "CONTACTED" | "RESOLVED">,
  actor: ActorContext,
  log = logDomainEvent,
) {
  const [alert] = await db
    .select()
    .from(deliveryAlerts)
    .where(and(eq(deliveryAlerts.id, alertId), eq(deliveryAlerts.orgId, orgId)));
  if (!alert) throw Errors.notFound("alerta de entrega no encontrada");
  if (alert.status === "RESOLVED") return alert;

  const now = new Date();
  const [updated] = await db
    .update(deliveryAlerts)
    .set({
      status,
      resolvedAt: status === "RESOLVED" ? now : null,
    })
    .where(eq(deliveryAlerts.id, alertId))
    .returning();
  if (!updated) throw Errors.internal("no se pudo actualizar la alerta");

  await db.transaction(async (tx) => {
    await log(
      {
        orgId,
        entityType: "ALERT",
        entityId: alert.shiftId,
        eventType:
          status === "RESOLVED" ? "DELIVERY_ALERT_RESOLVED" : "DELIVERY_ALERT_CONTACTED",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        fromStatus: alert.status,
        toStatus: status,
        occurredAt: now,
        metadata: { alertId: alert.id },
      },
      tx,
    );
  });

  return updated;
}
