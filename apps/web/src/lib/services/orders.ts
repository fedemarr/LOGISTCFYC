import { and, desc, eq, isNull } from "drizzle-orm";
import { haversineDistanceMeters } from "@fym/geo";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { driverShifts, storeOrders, storeOrdersToSelect, zones } from "@/lib/db/schema";
import { geocodeText } from "@/lib/services/geocoding";
import { logDomainEvent } from "@/lib/services/events";
import {
  TiendanubeApiError,
  fetchFulfillmentOrders,
  fetchOrders,
  updateFulfillmentOrderStatus,
  type TiendanubeOrder,
} from "@/lib/services/tiendanube-client";
import { getConnectionWithToken } from "@/lib/services/tiendanube";
import { uploadDeliveryEvidence } from "@/lib/storage";
import type { ActorContext } from "@/lib/services/zones";
import type { StoreOrderStatus } from "@fym/shared";

/**
 * PEDIDOS DE TIENDA NUBE (FYM) — pedido de un cliente por WhatsApp
 * (03/09/2026). `syncOrders` trae pedidos nuevos/actualizados y los
 * upsertea en `store_orders`, geocodificando los NUEVOS y sugiriendo la
 * zona más cercana (pedido de Fede: "agrupar por zona/cercanía y asignar
 * en bloque" en vez de pedido por pedido); `markOrderDelivered` es la
 * mitad que va para el OTRO lado: marca acá Y empuja el estado a Tienda
 * Nube (la parte de "crear el envío por fuera" del pedido original).
 */

/** Mapeo puro Tienda Nube → nuestros campos — separado de la DB para
 * poder testearlo sin mockear nada más pesado. */
export function mapTiendanubeOrder(order: TiendanubeOrder) {
  const addr = order.shipping_address;
  const addressParts = [addr?.address, addr?.number].filter(Boolean).join(" ");
  return {
    externalId: String(order.id),
    orderNumber: String(order.number),
    customerName: order.contact_name ?? null,
    customerPhone: order.contact_phone ?? addr?.phone ?? null,
    customerEmail: order.contact_email ?? null,
    shippingAddress: addressParts || null,
    shippingCity: addr?.city ?? addr?.locality ?? null,
    shippingProvince: addr?.province ?? null,
    externalStatus: order.shipping_status,
    rawPayload: order,
  };
}

/** Arma el texto a geocodificar a partir de las partes de la dirección —
 * lo más específico que haya, con Argentina al final para sesgar el
 * resultado (mismo criterio que `findOrCreateZoneByName`). */
function addressToGeocode(mapped: ReturnType<typeof mapTiendanubeOrder>): string | null {
  const parts = [
    mapped.shippingAddress,
    mapped.shippingCity,
    mapped.shippingProvince,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return `${parts.join(", ")}, Argentina`;
}

/** Zona activa más cercana CUYO RADIO contiene el punto — null si no cae
 * dentro de ninguna geocerca existente (el dispatcher la asigna a mano). */
async function findContainingZone(
  orgId: string,
  lat: number,
  lng: number,
): Promise<string | null> {
  const activeZones = await db
    .select({
      id: zones.id,
      centerLat: zones.centerLat,
      centerLng: zones.centerLng,
      radiusM: zones.radiusM,
    })
    .from(zones)
    .where(
      and(eq(zones.orgId, orgId), eq(zones.isActive, true), isNull(zones.deletedAt)),
    );

  let best: { id: string; distanceM: number } | null = null;
  for (const zone of activeZones) {
    const distanceM = haversineDistanceMeters(
      { lat, lng },
      { lat: zone.centerLat, lng: zone.centerLng },
    );
    if (distanceM > zone.radiusM) continue;
    if (!best || distanceM < best.distanceM) best = { id: zone.id, distanceM };
  }
  return best?.id ?? null;
}

/** Geocodifica un pedido nuevo y sugiere zona — nunca tira: si la
 * dirección no se puede ubicar, el pedido queda sin lat/lng/zona
 * sugerida y se asigna a mano, no bloquea el sync de los demás. */
async function geocodeAndSuggestZone(
  orgId: string,
  mapped: ReturnType<typeof mapTiendanubeOrder>,
): Promise<{ lat: number | null; lng: number | null; suggestedZoneId: string | null }> {
  const query = addressToGeocode(mapped);
  if (!query) return { lat: null, lng: null, suggestedZoneId: null };

  try {
    const geocoded = await geocodeText(query);
    const suggestedZoneId = await findContainingZone(orgId, geocoded.lat, geocoded.lng);
    return { lat: geocoded.lat, lng: geocoded.lng, suggestedZoneId };
  } catch {
    return { lat: null, lng: null, suggestedZoneId: null };
  }
}

/**
 * Trae pedidos de Tienda Nube y los upsertea. Sync incremental: si ya
 * hubo una sincronización, solo trae lo actualizado desde entonces. Los
 * pedidos NUEVOS se geocodifican (una llamada a la API de Google por
 * pedido, secuencial a propósito para no pasarse de las cuotas) — los ya
 * existentes NO se vuelven a geocodificar salvo que no tuvieran
 * coordenadas todavía.
 */
export async function syncOrders(
  orgId: string,
): Promise<{ synced: number; total: number }> {
  const conn = await getConnectionWithToken(orgId);
  if (!conn) throw Errors.conflict("no hay una tienda de Tienda Nube conectada");

  const [lastSynced] = await db
    .select({ syncedAt: storeOrders.syncedAt })
    .from(storeOrders)
    .where(eq(storeOrders.orgId, orgId))
    .orderBy(desc(storeOrders.syncedAt))
    .limit(1);

  let orders: TiendanubeOrder[];
  try {
    orders = await fetchOrders(conn.storeId, conn.accessToken, {
      updatedAtMin: lastSynced?.syncedAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof TiendanubeApiError) {
      throw Errors.internal(`Tienda Nube respondió ${err.status} al listar pedidos`);
    }
    throw err;
  }

  const now = new Date();
  for (const order of orders) {
    const mapped = mapTiendanubeOrder(order);
    const [existing] = await db
      .select({ id: storeOrders.id, lat: storeOrders.lat })
      .from(storeOrders)
      .where(
        and(eq(storeOrders.orgId, orgId), eq(storeOrders.externalId, mapped.externalId)),
      );

    if (existing) {
      const geo = existing.lat == null ? await geocodeAndSuggestZone(orgId, mapped) : {};
      await db
        .update(storeOrders)
        .set({ ...mapped, ...geo, syncedAt: now, updatedAt: now })
        .where(eq(storeOrders.id, existing.id));
    } else {
      const geo = await geocodeAndSuggestZone(orgId, mapped);
      await db.insert(storeOrders).values({
        orgId,
        ...mapped,
        ...geo,
        status: "PENDING",
        syncedAt: now,
      });
    }
  }

  return { synced: orders.length, total: orders.length };
}

export async function listOrders(orgId: string, status?: StoreOrderStatus) {
  return db
    .select({ ...storeOrdersToSelect, suggestedZoneName: zones.name })
    .from(storeOrders)
    .leftJoin(zones, eq(zones.id, storeOrders.suggestedZoneId))
    .where(
      and(
        eq(storeOrders.orgId, orgId),
        isNull(storeOrders.deletedAt),
        status ? eq(storeOrders.status, status) : undefined,
      ),
    )
    .orderBy(desc(storeOrders.syncedAt));
}

/** Pedidos asignados a UN turno — lo usa la PWA del chofer para mostrar
 * "mis pedidos" (mapa + lista) del turno que tiene en curso. */
export async function listOrdersForShift(orgId: string, shiftId: string) {
  return db
    .select(storeOrdersToSelect)
    .from(storeOrders)
    .where(
      and(
        eq(storeOrders.orgId, orgId),
        eq(storeOrders.shiftId, shiftId),
        isNull(storeOrders.deletedAt),
      ),
    )
    .orderBy(desc(storeOrders.syncedAt));
}

async function getOrder(orgId: string, orderId: string) {
  const [order] = await db
    .select()
    .from(storeOrders)
    .where(
      and(
        eq(storeOrders.id, orderId),
        eq(storeOrders.orgId, orgId),
        isNull(storeOrders.deletedAt),
      ),
    );
  if (!order) throw Errors.notFound("pedido no encontrado");
  return order;
}

/** Linkea el pedido a un turno de chofer (lo asigna un dispatcher). */
export async function assignOrderToShift(
  orgId: string,
  orderId: string,
  shiftId: string,
  actor: ActorContext,
  log = logDomainEvent,
) {
  const order = await getOrder(orgId, orderId);

  const [shift] = await db
    .select({ id: driverShifts.id })
    .from(driverShifts)
    .where(and(eq(driverShifts.id, shiftId), eq(driverShifts.orgId, orgId)));
  if (!shift) throw Errors.notFound("turno no encontrado");

  const now = new Date();
  const [updated] = await db
    .update(storeOrders)
    .set({ shiftId, status: "ASSIGNED", updatedAt: now })
    .where(eq(storeOrders.id, orderId))
    .returning();
  if (!updated) throw Errors.internal("no se pudo asignar el pedido");

  await db.transaction(async (tx) => {
    await log(
      {
        orgId,
        entityType: "ORDER",
        entityId: order.id,
        eventType: "ORDER_ASSIGNED",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        fromStatus: order.status,
        toStatus: "ASSIGNED",
        occurredAt: now,
        metadata: { shiftId },
      },
      tx,
    );
  });

  return updated;
}

/**
 * Asigna en bloque TODOS los pedidos PENDING sugeridos para una zona a un
 * turno de chofer — la parte de "agrupar y asignar en bloque" del pedido
 * de Fede, en vez de ir pedido por pedido con `assignOrderToShift`.
 */
export async function bulkAssignZoneToShift(
  orgId: string,
  zoneId: string,
  shiftId: string,
  actor: ActorContext,
  log = logDomainEvent,
): Promise<{ assigned: number }> {
  const [shift] = await db
    .select({ id: driverShifts.id })
    .from(driverShifts)
    .where(and(eq(driverShifts.id, shiftId), eq(driverShifts.orgId, orgId)));
  if (!shift) throw Errors.notFound("turno no encontrado");

  const pending = await db
    .select({ id: storeOrders.id })
    .from(storeOrders)
    .where(
      and(
        eq(storeOrders.orgId, orgId),
        eq(storeOrders.suggestedZoneId, zoneId),
        eq(storeOrders.status, "PENDING"),
        isNull(storeOrders.deletedAt),
      ),
    );
  if (pending.length === 0) return { assigned: 0 };

  const now = new Date();
  await db
    .update(storeOrders)
    .set({ shiftId, status: "ASSIGNED", updatedAt: now })
    .where(
      and(
        eq(storeOrders.orgId, orgId),
        eq(storeOrders.suggestedZoneId, zoneId),
        eq(storeOrders.status, "PENDING"),
        isNull(storeOrders.deletedAt),
      ),
    );

  await db.transaction(async (tx) => {
    await log(
      {
        orgId,
        entityType: "ORDER",
        entityId: shiftId,
        eventType: "ORDERS_BULK_ASSIGNED",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        toStatus: "ASSIGNED",
        occurredAt: now,
        metadata: { zoneId, shiftId, count: pending.length },
      },
      tx,
    );
  });

  return { assigned: pending.length };
}

/**
 * Marca el pedido como entregado ACÁ y empuja el estado a Tienda Nube
 * (busca el fulfillment-order del pedido y lo pasa a DELIVERED). Si el
 * push a Tienda Nube falla, el estado local queda igual (ya se entregó
 * de verdad, eso no depende de Tienda Nube) pero se devuelve el aviso —
 * el llamador decide qué mostrarle al dispatcher.
 */
export async function markOrderDelivered(
  orgId: string,
  orderId: string,
  actor: ActorContext,
  log = logDomainEvent,
  evidencePhotoPath?: string,
): Promise<{
  order: typeof storeOrders.$inferSelect;
  pushedToTiendaNube: boolean;
  pushError?: string;
}> {
  const order = await getOrder(orgId, orderId);
  if (order.status === "DELIVERED") {
    return { order, pushedToTiendaNube: true };
  }

  const now = new Date();
  const [updated] = await db
    .update(storeOrders)
    .set({
      status: "DELIVERED",
      deliveredAt: now,
      updatedAt: now,
      ...(evidencePhotoPath ? { evidencePhotoPath } : {}),
    })
    .where(eq(storeOrders.id, orderId))
    .returning();
  if (!updated) throw Errors.internal("no se pudo marcar el pedido como entregado");

  await db.transaction(async (tx) => {
    await log(
      {
        orgId,
        entityType: "ORDER",
        entityId: order.id,
        eventType: "ORDER_DELIVERED",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        fromStatus: order.status,
        toStatus: "DELIVERED",
        occurredAt: now,
      },
      tx,
    );
  });

  const conn = await getConnectionWithToken(orgId);
  if (!conn)
    return {
      order: updated,
      pushedToTiendaNube: false,
      pushError: "no hay tienda conectada",
    };

  try {
    const fulfillmentOrders = await fetchFulfillmentOrders(
      conn.storeId,
      conn.accessToken,
      order.externalId,
    );
    const target = fulfillmentOrders[0];
    if (!target) {
      return {
        order: updated,
        pushedToTiendaNube: false,
        pushError: "el pedido no tiene fulfillment-order en Tienda Nube",
      };
    }
    await updateFulfillmentOrderStatus(
      conn.storeId,
      conn.accessToken,
      order.externalId,
      target.id,
      "DELIVERED",
    );
    return { order: updated, pushedToTiendaNube: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { order: updated, pushedToTiendaNube: false, pushError: message };
  }
}

/**
 * Marca entregado DESDE LA PWA DEL CHOFER — pedido de Fede: mapa de
 * entregas + foto de confirmación. A diferencia de `markOrderDelivered`
 * (llamado por el panel, sin foto), acá la foto es OBLIGATORIA y se
 * verifica que el pedido esté asignado al turno ACTIVO de ESTE chofer
 * (un chofer no puede marcar entregado un pedido de otro).
 */
export async function markOrderDeliveredByDriver(
  orgId: string,
  orderId: string,
  driver: { userId: string; orgId: string },
  evidenceBase64: string,
  evidenceMimeType: string,
  log = logDomainEvent,
) {
  const order = await getOrder(orgId, orderId);
  if (!order.shiftId) {
    throw Errors.conflict("este pedido todavía no está asignado a un turno");
  }

  const [shift] = await db
    .select({ id: driverShifts.id })
    .from(driverShifts)
    .where(
      and(
        eq(driverShifts.id, order.shiftId),
        eq(driverShifts.driverId, driver.userId),
        eq(driverShifts.orgId, orgId),
      ),
    );
  if (!shift) throw Errors.forbidden("este pedido no está asignado a tu turno");

  const evidencePath = await uploadDeliveryEvidence(
    orgId,
    orderId,
    evidenceBase64,
    evidenceMimeType,
  );

  return markOrderDelivered(
    orgId,
    orderId,
    { actorId: driver.userId, actorRole: "driver" },
    log,
    evidencePath,
  );
}

export async function markOrderFailed(
  orgId: string,
  orderId: string,
  actor: ActorContext,
  log = logDomainEvent,
) {
  const order = await getOrder(orgId, orderId);
  const now = new Date();
  const [updated] = await db
    .update(storeOrders)
    .set({ status: "FAILED", updatedAt: now })
    .where(eq(storeOrders.id, orderId))
    .returning();
  if (!updated) throw Errors.internal("no se pudo actualizar el pedido");

  await db.transaction(async (tx) => {
    await log(
      {
        orgId,
        entityType: "ORDER",
        entityId: order.id,
        eventType: "ORDER_FAILED",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        fromStatus: order.status,
        toStatus: "FAILED",
        occurredAt: now,
      },
      tx,
    );
  });

  return updated;
}
