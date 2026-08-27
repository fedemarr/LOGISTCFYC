import { and, desc, eq, isNull } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { driverShifts, users, zoneAlerts, zones } from "@/lib/db/schema";
import { logDomainEvent } from "@/lib/services/events";
import type { ActorContext } from "@/lib/services/zones";

/**
 * ALERTAS DE GEOCERCA (FYM) — lectura para el panel + resolución manual.
 * La creación/cierre automático vive en `shifts.evaluateGeofence()`.
 */

const alertViewSelect = {
  id: zoneAlerts.id,
  alertType: zoneAlerts.alertType,
  status: zoneAlerts.status,
  distanceOutsideM: zoneAlerts.distanceOutsideM,
  triggeredAt: zoneAlerts.triggeredAt,
  resolvedAt: zoneAlerts.resolvedAt,
  shift: { id: driverShifts.id, packageCount: driverShifts.packageCount },
  driver: {
    id: users.id,
    fullName: users.fullName,
    phone: users.phone,
  },
  zone: { id: zones.id, name: zones.name, colorHex: zones.colorHex },
} as const;

export async function listAlerts(orgId: string, status?: "OPEN" | "RESOLVED") {
  return db
    .select(alertViewSelect)
    .from(zoneAlerts)
    .innerJoin(driverShifts, eq(driverShifts.id, zoneAlerts.shiftId))
    .innerJoin(users, eq(users.id, zoneAlerts.driverId))
    .innerJoin(zones, eq(zones.id, zoneAlerts.zoneId))
    .where(
      and(
        eq(zoneAlerts.orgId, orgId),
        isNull(zoneAlerts.deletedAt),
        status ? eq(zoneAlerts.status, status) : undefined,
      ),
    )
    .orderBy(desc(zoneAlerts.triggeredAt));
}

export async function resolveAlert(
  orgId: string,
  alertId: string,
  actor: ActorContext,
  log = logDomainEvent,
) {
  const [alert] = await db
    .select()
    .from(zoneAlerts)
    .where(
      and(
        eq(zoneAlerts.id, alertId),
        eq(zoneAlerts.orgId, orgId),
        isNull(zoneAlerts.deletedAt),
      ),
    );
  if (!alert) throw Errors.notFound("alerta no encontrada");
  if (alert.status === "RESOLVED") return alert;

  const [updated] = await db
    .update(zoneAlerts)
    .set({ status: "RESOLVED", resolvedAt: new Date() })
    .where(eq(zoneAlerts.id, alertId))
    .returning();

  await db.transaction(async (tx) => {
    await log(
      {
        orgId,
        entityType: "ALERT",
        entityId: alert.shiftId,
        eventType: "ALERT_RESOLVED",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        fromStatus: "OPEN",
        toStatus: "RESOLVED",
        occurredAt: new Date(),
        metadata: { alertId },
      },
      tx,
    );
  });

  return updated;
}
