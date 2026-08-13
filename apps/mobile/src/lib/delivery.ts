import type { SQLiteDatabase } from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import { enqueueAction } from "./sync/outbox";

/**
 * Enqueue de las acciones de la calle del chofer (§9.5-§9.9, FASE 10) —
 * espejo de `apps/web/src/lib/services/delivery.ts`. Todo entra por el
 * outbox local (`enqueueAction` → `POST /api/sync`) así el flujo es
 * offline-first: sin señal, las entregas quedan encoladas y se sincronizan
 * cuando vuelve (el servidor dedupe por idempotencyKey).
 *
 * La clave `deliveryKey` se genera acá (UUID) y viaja dentro del payload:
 * el servidor la usa como `deliveries.idempotency_key` y es lo que permite
 * adjuntarle fotos que suben después (DELIVERY_PHOTO_ATTACH).
 */

export interface DeliverInput {
  routeId: string;
  stopId: string;
  receiverName: string;
  receiverRelationship?: string;
  distanceFromTargetM: number;
  lat: number;
  lng: number;
  gpsAccuracyM?: number;
  photoUrls: string[];
  deviceId?: string;
}

export interface FailInput {
  routeId: string;
  stopId: string;
  reason: string;
  comment?: string;
  photoUrls?: string[];
  lat?: number;
  lng?: number;
  deviceId?: string;
}

/** STOP_ARRIVED — §9.5: llegada a la parada (se encola al abrir la pantalla de la parada). */
export async function enqueueStopArrived(
  db: SQLiteDatabase,
  routeId: string,
  stopId: string,
): Promise<string> {
  return enqueueAction(db, "STOP_ARRIVED", {
    routeId,
    stopId,
    arrivedAt: new Date().toISOString(),
  });
}

/** DELIVERY_DELIVERED — §9.5/§9.6: entrega con evidencia mínima. */
export async function enqueueDeliveryDelivered(
  db: SQLiteDatabase,
  input: DeliverInput,
): Promise<{ idempotencyKey: string; deliveryKey: string }> {
  const deliveryKey = randomUUID();
  const idempotencyKey = await enqueueAction(db, "DELIVERY_DELIVERED", {
    routeId: input.routeId,
    stopId: input.stopId,
    receiverName: input.receiverName,
    receiverRelationship: input.receiverRelationship,
    distanceFromTargetM: input.distanceFromTargetM,
    lat: input.lat,
    lng: input.lng,
    gpsAccuracyM: input.gpsAccuracyM,
    photoUrls: input.photoUrls,
    deliveryKey,
    deviceId: input.deviceId,
    deliveredAt: new Date().toISOString(),
  });
  return { idempotencyKey, deliveryKey };
}

/** DELIVERY_FAILED — §9.7: incidencia (motivo + foto obligatoria). */
export async function enqueueDeliveryFailed(
  db: SQLiteDatabase,
  input: FailInput,
): Promise<string> {
  return enqueueAction(db, "DELIVERY_FAILED", {
    routeId: input.routeId,
    stopId: input.stopId,
    reason: input.reason,
    comment: input.comment,
    photoUrls: input.photoUrls,
    lat: input.lat,
    lng: input.lng,
    deviceId: input.deviceId,
    reportedAt: new Date().toISOString(),
  });
}

/** STOPS_REORDERED — §9.8: secuencia completa de paradas después de un reorden manual. */
export async function enqueueStopsReordered(
  db: SQLiteDatabase,
  routeId: string,
  orderedStopIds: string[],
): Promise<string> {
  return enqueueAction(db, "STOPS_REORDERED", {
    routeId,
    orderedStopIds,
    reorderedAt: new Date().toISOString(),
  });
}

/** ROUTE_FINISHED — §9.9: cierre del día del chofer. */
export async function enqueueRouteFinished(
  db: SQLiteDatabase,
  routeId: string,
  finalLat?: number,
  finalLng?: number,
): Promise<string> {
  return enqueueAction(db, "ROUTE_FINISHED", {
    routeId,
    finishedAt: new Date().toISOString(),
    ...(finalLat != null ? { finalLat } : {}),
    ...(finalLng != null ? { finalLng } : {}),
  });
}
