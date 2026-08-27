import { and, eq, isNull } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { zones } from "@/lib/db/schema";
import { logDomainEvent } from "@/lib/services/events";

export interface ActorContext {
  actorId: string;
  actorRole: string;
}

/**
 * Zonas geográficas del sistema FYM. Cada zona es un círculo (centro +
 * radio_m). El chofer arranca un turno asignado a una zona y el motor de
 * geocerca genera `LEFT_ZONE` si su GPS se aleja del radio.
 */

export interface ZoneInput {
  name: string;
  colorHex?: string;
  centerLat: number;
  centerLng: number;
  radiusM: number;
}

export async function listZones(orgId: string): Promise<(typeof zones.$inferSelect)[]> {
  return db
    .select()
    .from(zones)
    .where(and(eq(zones.orgId, orgId), isNull(zones.deletedAt)))
    .orderBy(zones.name);
}

export async function getZone(orgId: string, zoneId: string) {
  const [zone] = await db
    .select()
    .from(zones)
    .where(and(eq(zones.id, zoneId), eq(zones.orgId, orgId), isNull(zones.deletedAt)));
  if (!zone) throw Errors.notFound("zona no encontrada");
  return zone;
}

export async function createZone(
  orgId: string,
  actor: ActorContext,
  input: ZoneInput,
  log = logDomainEvent,
) {
  const [zone] = await db
    .insert(zones)
    .values({ orgId, ...input })
    .returning();
  if (!zone) throw Errors.internal("no se pudo crear la zona");

  const now = new Date();
  await db.transaction(async (tx) => {
    await log(
      {
        orgId,
        entityType: "ZONE",
        entityId: zone.id,
        eventType: "ZONE_CREATED",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        toStatus: "ACTIVE",
        occurredAt: now,
        metadata: { name: zone.name },
      },
      tx,
    );
  });

  return zone;
}

export async function updateZone(
  orgId: string,
  zoneId: string,
  actor: ActorContext,
  patch: Partial<ZoneInput>,
  log = logDomainEvent,
) {
  const existing = await getZone(orgId, zoneId);

  const clean: ZoneInput = {
    name: patch.name ?? existing.name,
    colorHex: patch.colorHex ?? existing.colorHex,
    centerLat: patch.centerLat ?? existing.centerLat,
    centerLng: patch.centerLng ?? existing.centerLng,
    radiusM: patch.radiusM ?? existing.radiusM,
  };

  const [updated] = await db
    .update(zones)
    .set({ ...clean, updatedAt: new Date() })
    .where(eq(zones.id, zoneId))
    .returning();

  if (!updated) throw Errors.internal("no se pudo actualizar la zona");

  await db.transaction(async (tx) => {
    await log(
      {
        orgId,
        entityType: "ZONE",
        entityId: zoneId,
        eventType: "ZONE_UPDATED",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        occurredAt: new Date(),
        metadata: { name: updated.name },
      },
      tx,
    );
  });

  return updated;
}

export async function softDeleteZone(
  orgId: string,
  zoneId: string,
  actor: ActorContext,
  log = logDomainEvent,
): Promise<void> {
  await getZone(orgId, zoneId);
  await db
    .update(zones)
    .set({ deletedAt: new Date(), isActive: false })
    .where(eq(zones.id, zoneId));

  await db.transaction(async (tx) => {
    await log(
      {
        orgId,
        entityType: "ZONE",
        entityId: zoneId,
        eventType: "ZONE_DELETED",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        occurredAt: new Date(),
      },
      tx,
    );
  });
}
