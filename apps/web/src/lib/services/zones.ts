import { and, eq, isNull, sql } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { zones } from "@/lib/db/schema";
import { geocodeText } from "@/lib/services/geocoding";
import { logDomainEvent } from "@/lib/services/events";

/** Radio por default de una zona creada al vuelo por texto libre del
 * chofer (pedido de Fede) — no hay UI para elegirlo, así que va generoso
 * (una localidad entera, no una geocerca de admin ajustada a mano). El
 * admin la puede editar después desde `/zonas` como cualquier otra. */
const FREE_TEXT_ZONE_RADIUS_M = 6_000;

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

/**
 * Resuelve la zona a partir de texto libre escrito por el chofer al
 * arrancar el turno (pedido de Fede: "que deje escribirla" en vez de
 * elegir de una lista fija) — reusa una zona existente de la org si el
 * nombre ya coincide (sin re-geocodificar ni duplicar), o geocodifica y
 * crea una nueva. Esa zona queda como cualquier otra: visible/editable
 * en `/zonas`, y el turno aparece en el mapa de `/monitoreo` centrado ahí.
 */
export async function findOrCreateZoneByName(
  orgId: string,
  actor: ActorContext,
  rawName: string,
  log = logDomainEvent,
): Promise<typeof zones.$inferSelect> {
  const name = rawName.trim();
  if (!name) throw Errors.validation("falta el nombre de la zona");

  const [existing] = await db
    .select()
    .from(zones)
    .where(
      and(
        eq(zones.orgId, orgId),
        isNull(zones.deletedAt),
        sql`lower(${zones.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  if (existing) return existing;

  const geocoded = await geocodeText(name);

  return createZone(
    orgId,
    actor,
    {
      name,
      centerLat: geocoded.lat,
      centerLng: geocoded.lng,
      radiusM: FREE_TEXT_ZONE_RADIUS_M,
    },
    log,
  );
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
