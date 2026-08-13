/**
 * Motor de sincronización — lado servidor del patrón outbox de §12.
 * `apps/mobile` encola acciones localmente con un `idempotencyKey` (UUID
 * generado en el dispositivo) y las manda acá en lotes; este servicio es
 * la única puerta de entrada — dedupe por `idempotencyKey` PRIMERO
 * (`sync_queue.idempotency_key` es `unique`, §12: "reenviar es SIEMPRE
 * seguro"), y solo después ejecuta el efecto de negocio correspondiente
 * al `operationType`.
 *
 * FASE 7 (base del motor) implementó el primer `operationType` (`GPS_PING`).
 * FASE 10 suma las acciones de la calle: `STOP_ARRIVED`, `DELIVERY_DELIVERED`,
 * `DELIVERY_FAILED`, `STOPS_REORDERED`, `DELIVERY_PHOTO_ATTACH` y
 * `ROUTE_FINISHED` (sus efectos de negocio viven en `delivery.ts`).
 * Agregar un tipo nuevo es: sumarlo a `SYNC_OPERATION_TYPES`
 * (`@fyc/shared`) + un `case` acá — nunca un `if` disperso.
 */
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import type { SyncAction, SyncActionResult } from "@fyc/shared";
import { db } from "@/lib/db";
import { driverLocations, syncQueue } from "@/lib/db/schema";
import type { AuthContext } from "@/lib/api/auth";
import {
  arriveAtStop,
  attachDeliveryPhoto,
  finishRoute,
  recordDelivery,
  reorderStops,
  reportDeliveryFailed,
} from "./delivery";

const gpsPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).optional(),
  speedMps: z.number().min(0).optional(),
  heading: z.number().min(0).max(360).optional(),
  batteryLevel: z.number().min(0).max(1).optional(),
  isMoving: z.boolean().optional(),
  routeId: z.string().uuid().optional(),
});

const uuidSchema = z.string().uuid();
const isoDateSchema = z.string().datetime();
const coordSchema = z.number().min(-90).max(90);
const coordLngSchema = z.number().min(-180).max(180);

const stopArrivedSchema = z.object({
  routeId: uuidSchema,
  stopId: uuidSchema,
  arrivedAt: isoDateSchema,
});

const deliveryDeliveredSchema = z.object({
  routeId: uuidSchema,
  stopId: uuidSchema,
  receiverName: z.string().trim().min(1, "el nombre del receptor es obligatorio (§9.6)"),
  receiverRelationship: z.string().trim().optional(),
  distanceFromTargetM: z.number().min(0),
  lat: coordSchema,
  lng: coordLngSchema,
  gpsAccuracyM: z.number().min(0).optional(),
  photoUrls: z.array(z.string().min(1)).default([]),
  deliveryKey: z.string().uuid(),
  deviceId: z.string().min(1).max(200).optional(),
  deliveredAt: isoDateSchema,
});

const deliveryFailedSchema = z.object({
  routeId: uuidSchema,
  stopId: uuidSchema,
  reason: z.enum([
    "NO_ONE_HOME",
    "NO_ANSWER",
    "WRONG_ADDRESS",
    "NONEXISTENT_ADDRESS",
    "REFUSED",
    "NO_ACCESS",
    "UNSAFE_AREA",
    "VEHICLE_ISSUE",
    "DAMAGED",
    "MISSING_BULK",
    "OTHER",
  ]),
  comment: z.string().trim().optional(),
  photoUrls: z.array(z.string().min(1)).optional(),
  lat: coordSchema.optional(),
  lng: coordLngSchema.optional(),
  deviceId: z.string().min(1).max(200).optional(),
  reportedAt: isoDateSchema,
});

const stopsReorderedSchema = z.object({
  routeId: uuidSchema,
  orderedStopIds: z.array(uuidSchema).min(1),
  reorderedAt: isoDateSchema,
});

const deliveryPhotoAttachSchema = z.object({
  routeId: uuidSchema,
  stopId: uuidSchema,
  deliveryKey: z.string().uuid(),
  photoUrl: z.string().min(1),
  attachedAt: isoDateSchema,
});

const routeFinishedSchema = z.object({
  routeId: uuidSchema,
  finishedAt: isoDateSchema,
  finalLat: coordSchema.optional(),
  finalLng: coordLngSchema.optional(),
});

async function applyGpsPing(
  ctx: AuthContext,
  payload: unknown,
  clientTimestamp: string,
): Promise<void> {
  const parsed = gpsPingSchema.parse(payload);
  await db.insert(driverLocations).values({
    orgId: ctx.orgId,
    driverId: ctx.userId,
    routeId: parsed.routeId,
    lat: parsed.lat,
    lng: parsed.lng,
    accuracyM: parsed.accuracyM,
    speedMps: parsed.speedMps,
    heading: parsed.heading,
    batteryLevel: parsed.batteryLevel,
    isMoving: parsed.isMoving,
    recordedAt: new Date(clientTimestamp),
  });
}

/** Ejecuta el efecto de negocio de una acción ya deduplicada. Tira si el payload no matchea — el caller la marca FAILED. */
async function applyAction(ctx: AuthContext, action: SyncAction): Promise<void> {
  switch (action.operationType) {
    case "GPS_PING":
      await applyGpsPing(ctx, action.payload, action.clientTimestamp);
      return;
    case "STOP_ARRIVED":
      await arriveAtStop(ctx.orgId, ctx.userId, stopArrivedSchema.parse(action.payload));
      return;
    case "DELIVERY_DELIVERED":
      await recordDelivery(
        ctx.orgId,
        ctx.userId,
        deliveryDeliveredSchema.parse(action.payload),
      );
      return;
    case "DELIVERY_FAILED":
      await reportDeliveryFailed(
        ctx.orgId,
        ctx.userId,
        deliveryFailedSchema.parse(action.payload),
      );
      return;
    case "STOPS_REORDERED":
      await reorderStops(
        ctx.orgId,
        ctx.userId,
        stopsReorderedSchema.parse(action.payload),
      );
      return;
    case "DELIVERY_PHOTO_ATTACH":
      await attachDeliveryPhoto(
        ctx.orgId,
        ctx.userId,
        deliveryPhotoAttachSchema.parse(action.payload),
      );
      return;
    case "ROUTE_FINISHED":
      await finishRoute(ctx.orgId, ctx.userId, routeFinishedSchema.parse(action.payload));
      return;
    default: {
      const exhaustive: never = action.operationType;
      throw new Error(`operationType desconocido: ${String(exhaustive)}`);
    }
  }
}

/**
 * Procesa un lote de acciones del outbox. Cada una es independiente: una
 * falla no aborta las demás (el chofer encoló 5 acciones en modo avión,
 * las 5 tienen que intentar aplicarse aunque una tenga un payload raro).
 */
export async function processSyncBatch(
  ctx: AuthContext,
  deviceId: string,
  actions: SyncAction[],
): Promise<SyncActionResult[]> {
  const results: SyncActionResult[] = [];

  for (const action of actions) {
    const [inserted] = await db
      .insert(syncQueue)
      .values({
        deviceId,
        userId: ctx.userId,
        idempotencyKey: action.idempotencyKey,
        operationType: action.operationType,
        payload: action.payload,
        clientTimestamp: new Date(action.clientTimestamp),
      })
      .onConflictDoNothing({ target: syncQueue.idempotencyKey })
      .returning({ id: syncQueue.id, status: syncQueue.status });

    if (!inserted) {
      // Ya vino antes (reintento, doble envío) — mirar en qué quedó en
      // vez de re-aplicar el efecto de negocio de nuevo.
      const [existing] = await db
        .select({ status: syncQueue.status })
        .from(syncQueue)
        .where(eq(syncQueue.idempotencyKey, action.idempotencyKey));
      if (existing?.status === "COMPLETED") {
        results.push({ idempotencyKey: action.idempotencyKey, status: "DUPLICATE" });
        continue;
      }
      // Quedó PENDING/FAILED de un intento anterior — reintentar aplicarlo.
    }

    try {
      await applyAction(ctx, action);
      await db
        .update(syncQueue)
        .set({ status: "COMPLETED", processedAt: new Date() })
        .where(eq(syncQueue.idempotencyKey, action.idempotencyKey));
      results.push({ idempotencyKey: action.idempotencyKey, status: "COMPLETED" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "error desconocido";
      await db
        .update(syncQueue)
        .set({
          status: "FAILED",
          lastError: message,
          attempts: sql`${syncQueue.attempts} + 1`,
        })
        .where(eq(syncQueue.idempotencyKey, action.idempotencyKey));
      results.push({
        idempotencyKey: action.idempotencyKey,
        status: "FAILED",
        error: message,
      });
    }
  }

  return results;
}
