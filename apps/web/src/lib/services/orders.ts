import { and, desc, eq, isNull } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { driverShifts, storeOrders, storeOrdersToSelect } from "@/lib/db/schema";
import { logDomainEvent } from "@/lib/services/events";
import {
  TiendanubeApiError,
  fetchFulfillmentOrders,
  fetchOrders,
  updateFulfillmentOrderStatus,
  type TiendanubeOrder,
} from "@/lib/services/tiendanube-client";
import { getConnectionWithToken } from "@/lib/services/tiendanube";
import type { ActorContext } from "@/lib/services/zones";
import type { StoreOrderStatus } from "@fym/shared";

/**
 * PEDIDOS DE TIENDA NUBE (FYM) — pedido de un cliente por WhatsApp
 * (03/09/2026). `syncOrders` trae pedidos nuevos/actualizados y los
 * upsertea en `store_orders`; `markOrderDelivered` es la mitad que va
 * para el OTRO lado: marca acá Y empuja el estado a Tienda Nube (la
 * parte de "crear el envío por fuera" del pedido original).
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

/** Trae pedidos de Tienda Nube y los upsertea. Sync incremental: si ya
 * hubo una sincronización, solo trae lo actualizado desde entonces. */
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
      .select({ id: storeOrders.id })
      .from(storeOrders)
      .where(
        and(eq(storeOrders.orgId, orgId), eq(storeOrders.externalId, mapped.externalId)),
      );

    if (existing) {
      await db
        .update(storeOrders)
        .set({ ...mapped, syncedAt: now, updatedAt: now })
        .where(eq(storeOrders.id, existing.id));
    } else {
      await db.insert(storeOrders).values({
        orgId,
        ...mapped,
        status: "PENDING",
        syncedAt: now,
      });
    }
  }

  return { synced: orders.length, total: orders.length };
}

export async function listOrders(orgId: string, status?: StoreOrderStatus) {
  return db
    .select(storeOrdersToSelect)
    .from(storeOrders)
    .where(
      and(
        eq(storeOrders.orgId, orgId),
        isNull(storeOrders.deletedAt),
        status ? eq(storeOrders.status, status) : undefined,
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
    .set({ status: "DELIVERED", deliveredAt: now, updatedAt: now })
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
