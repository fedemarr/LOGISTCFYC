/**
 * Motor de sincronización — lado servidor del patrón outbox de §12.
 * `apps/mobile` encola acciones localmente con un `idempotencyKey` (UUID
 * generado en el dispositivo) y las manda acá en lotes; este servicio es
 * la única puerta de entrada — dedupe por `idempotencyKey` PRIMERO
 * (`sync_queue.idempotency_key` es `unique`, §12: "reenviar es SIEMPRE
 * seguro"), y solo después ejecuta el efecto de negocio correspondiente
 * al `operationType`.
 *
 * FASE 7 (base del motor) implementa un solo `operationType` (`GPS_PING`)
 * — alcanza para probar el círculo completo del patrón (encolar → mandar
 * → dedupe → aplicar → marcar) sin depender de reglas de negocio de fases
 * que todavía no existen (entrega en FASE 10, incidencias en FASE 9/12).
 * Agregar un tipo nuevo es: sumarlo a `SYNC_OPERATION_TYPES`
 * (`@fyc/shared`) + un `case` acá — nunca un `if` disperso.
 */
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import type { SyncAction, SyncActionResult } from "@fyc/shared";
import { db } from "@/lib/db";
import { driverLocations, syncQueue } from "@/lib/db/schema";
import type { AuthContext } from "@/lib/api/auth";

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
