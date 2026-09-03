import { eq } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { tiendanubeConnectionPublicSelect, tiendanubeConnections } from "@/lib/db/schema";
import { logDomainEvent } from "@/lib/services/events";
import {
  TiendanubeApiError,
  verifyConnection,
  type TiendanubeStore,
} from "@/lib/services/tiendanube-client";

/**
 * CONEXIÓN CON TIENDA NUBE (FYM) — pedido de un cliente por WhatsApp
 * (03/09/2026): sincronizar pedidos + gestionar el envío desde acá. Una
 * conexión por org (1:1, `tiendanube_connections.org_id` es UNIQUE).
 */

export interface ActorContext {
  actorId: string;
  actorRole: string;
}

function storeName(store: TiendanubeStore): string | null {
  if (typeof store.name === "string") return store.name;
  if (store.name && typeof store.name === "object") {
    return store.name.es ?? store.name.pt ?? Object.values(store.name)[0] ?? null;
  }
  return null;
}

/** Estado de la conexión SIN el token — lo único que puede tocar el
 * cliente (ver `tiendanubeConnectionPublicSelect`). */
export async function getConnection(orgId: string) {
  const [conn] = await db
    .select(tiendanubeConnectionPublicSelect)
    .from(tiendanubeConnections)
    .where(eq(tiendanubeConnections.orgId, orgId));
  return conn ?? null;
}

/** SOLO para uso interno de `services/orders.ts` — incluye el token. */
export async function getConnectionWithToken(orgId: string) {
  const [conn] = await db
    .select()
    .from(tiendanubeConnections)
    .where(eq(tiendanubeConnections.orgId, orgId));
  return conn ?? null;
}

/** Conecta (o reemplaza) la tienda de la org — valida el token contra la
 * API ANTES de guardarlo, para no dejar guardada una credencial que no
 * funciona. */
export async function connectStore(
  orgId: string,
  actor: ActorContext,
  input: { storeId: string; accessToken: string },
  log = logDomainEvent,
) {
  let store: TiendanubeStore;
  try {
    store = await verifyConnection(input.storeId, input.accessToken);
  } catch (err) {
    if (err instanceof TiendanubeApiError && err.status === 401) {
      throw Errors.validation("token inválido o vencido — revisá la aplicación a medida");
    }
    throw Errors.validation(
      `no se pudo verificar la conexión con Tienda Nube: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const now = new Date();
  const [existing] = await db
    .select({ id: tiendanubeConnections.id })
    .from(tiendanubeConnections)
    .where(eq(tiendanubeConnections.orgId, orgId));

  const values = {
    orgId,
    storeId: input.storeId,
    accessToken: input.accessToken,
    shopName: storeName(store),
    connectedBy: actor.actorId,
    connectedAt: now,
    updatedAt: now,
  };

  const [saved] = existing
    ? await db
        .update(tiendanubeConnections)
        .set(values)
        .where(eq(tiendanubeConnections.orgId, orgId))
        .returning()
    : await db.insert(tiendanubeConnections).values(values).returning();
  if (!saved) throw Errors.internal("no se pudo guardar la conexión");

  await db.transaction(async (tx) => {
    await log(
      {
        orgId,
        entityType: "ORDER",
        entityId: saved.id,
        eventType: "TIENDANUBE_CONNECTED",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        occurredAt: now,
        metadata: { shopName: saved.shopName, storeId: saved.storeId },
      },
      tx,
    );
  });

  return {
    id: saved.id,
    orgId: saved.orgId,
    storeId: saved.storeId,
    shopName: saved.shopName,
    connectedAt: saved.connectedAt,
  };
}

export async function disconnectStore(
  orgId: string,
  actor: ActorContext,
  log = logDomainEvent,
): Promise<void> {
  const [existing] = await db
    .select({ id: tiendanubeConnections.id })
    .from(tiendanubeConnections)
    .where(eq(tiendanubeConnections.orgId, orgId));
  if (!existing) throw Errors.notFound("no hay una tienda conectada");

  await db.delete(tiendanubeConnections).where(eq(tiendanubeConnections.orgId, orgId));

  await db.transaction(async (tx) => {
    await log(
      {
        orgId,
        entityType: "ORDER",
        entityId: existing.id,
        eventType: "TIENDANUBE_DISCONNECTED",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        occurredAt: new Date(),
      },
      tx,
    );
  });
}
