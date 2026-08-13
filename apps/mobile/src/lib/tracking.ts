import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import * as Battery from "expo-battery";
import { DB_NAME } from "./db/schema";
import { enqueueAction } from "./sync/outbox";
import { haversineDistanceMeters } from "./geo";

/**
 * TRACKING DE UBICACIÓN — PROMPT-MAESTRO §10 (FASE 11).
 *
 * Dos capas, como pide §10 ("cada 100 m", "cada 30 s", "cada 2 min
 * detenido", "cada 15 s cerca de una parada"):
 *
 *   - Background (app cerrada o en segundo plano): una tarea de
 *     `expo-task-manager` con `distanceInterval: 100` → un ping por cada
 *     100 m recorridos. El task abre SOLO su conexión a SQLite, encola el
 *     GPS_PING y cierra (la app del chofer ya tiene el motor de sync
 *     corriendo mientras está abierta; el task solo encola).
 *   - Foreground (app en pantalla): un timer adaptativo — 15 s si está a
 *     <200 m de la próxima parada pendiente, 30 s si se mueve, 2 min si
 *     está quieto.
 *
 * Toda coordenada viaja por el outbox (`GPS_PING`) con `recordedAt` del
 * dispositivo; el servidor jamás confunde eso con su hora de recepción (§10).
 */

const TASK_NAME = "fyc-gps-tracking";
const NEAR_STOP_M = 200;
const MOVING_THRESHOLD_M = 50;

export const GPS_TASK_NAME = TASK_NAME;

interface TaskData {
  locations?: Location.LocationObject[];
}

TaskManager.defineTask(
  TASK_NAME,
  async ({ data, error }: TaskManager.TaskManagerTaskBody) => {
    if (error) return;
    const locations = (data as TaskData | undefined)?.locations ?? [];
    const last = locations[locations.length - 1];
    if (!last) return;

    try {
      const db = await openDatabaseAsync(DB_NAME);
      const route = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM local_route WHERE status = 'IN_TRANSIT' LIMIT 1`,
      );
      if (route) {
        await enqueueAction(db, "GPS_PING", {
          lat: last.coords.latitude,
          lng: last.coords.longitude,
          accuracyM: last.coords.accuracy ?? undefined,
          speedMps:
            last.coords.speed != null && last.coords.speed > 0
              ? last.coords.speed
              : undefined,
          heading: last.coords.heading ?? undefined,
          batteryLevel: await Battery.getBatteryLevelAsync().catch(() => undefined),
          isMoving: (last.coords.speed ?? 0) > 1,
          routeId: route.id,
        });
      }
      await db.closeAsync();
    } catch {
      // Sin DB o sin sesión — se descarta el ping, el próximo ciclo reintenta.
    }
  },
);

/** Arranca el tracking de background (solo ruta IN_TRANSIT). */
export async function startBackgroundTracking(): Promise<void> {
  const hasPermission = await Location.hasServicesEnabledAsync();
  if (!hasPermission) return;
  const hasStarted = await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
  if (hasStarted) return;

  await Location.startLocationUpdatesAsync(TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 100,
    pausesUpdatesAutomatically: true,
    activityType: Location.ActivityType.OtherNavigation,
    foregroundService: {
      notificationTitle: "FYC · reparto en curso",
      notificationBody: "Compartiendo tu ubicación con la central",
      notificationColor: "#22C55E",
    },
  });
}

/** Detiene el tracking de background (final de ruta). */
export async function stopBackgroundTracking(): Promise<void> {
  const hasStarted = await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
  if (hasStarted) {
    await Location.stopLocationUpdatesAsync(TASK_NAME);
  }
}

export interface AdaptiveTimer {
  start: (dbHandle: unknown) => void;
  stop: () => void;
}

let adaptiveHandle: ReturnType<typeof setTimeout> | null = null;
let lastPosition: { lat: number; lng: number } | null = null;
let activeDb: unknown = null;

function clearAdaptiveTimer(): void {
  if (adaptiveHandle != null) {
    clearTimeout(adaptiveHandle);
    adaptiveHandle = null;
  }
}

async function tickLoop(): Promise<void> {
  try {
    const db = activeDb as SQLiteDatabase;
    const nextStop = await db.getFirstAsync<{ lat: number | null; lng: number | null }>(
      `SELECT lat, lng FROM local_stop
       WHERE route_id = (SELECT id FROM local_route WHERE status = 'IN_TRANSIT' LIMIT 1)
         AND status IN ('PENDING', 'ARRIVED') AND lat IS NOT NULL AND lng IS NOT NULL
       ORDER BY sequence ASC LIMIT 1`,
    );

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const current = { lat: pos.coords.latitude, lng: pos.coords.longitude };

    const route = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM local_route WHERE status = 'IN_TRANSIT' LIMIT 1`,
    );
    if (route) {
      await enqueueAction(db, "GPS_PING", {
        lat: current.lat,
        lng: current.lng,
        accuracyM: pos.coords.accuracy ?? undefined,
        speedMps:
          pos.coords.speed != null && pos.coords.speed > 0 ? pos.coords.speed : undefined,
        heading: pos.coords.heading ?? undefined,
        batteryLevel: await Battery.getBatteryLevelAsync().catch(() => undefined),
        isMoving: (pos.coords.speed ?? 0) > 1,
        routeId: route.id,
      });
    }

    const movedM =
      lastPosition != null ? haversineDistanceMeters(lastPosition, current) : Infinity;
    lastPosition = current;

    let delay = 30_000;
    if (nextStop?.lat != null && nextStop.lng != null) {
      const toStopM = haversineDistanceMeters(current, {
        lat: nextStop.lat,
        lng: nextStop.lng,
      });
      if (toStopM < NEAR_STOP_M) delay = 15_000;
      else if (movedM > MOVING_THRESHOLD_M) delay = 30_000;
      else delay = 120_000;
    } else if (movedM > MOVING_THRESHOLD_M) {
      delay = 30_000;
    } else {
      delay = 120_000;
    }
    adaptiveHandle = setTimeout(() => void tickLoop(), delay);
  } catch {
    adaptiveHandle = setTimeout(() => void tickLoop(), 30_000);
  }
}

/** Timer adaptativo de primer plano: cada tick encola un GPS_PING y decide el próximo intervalo (§10). */
export const adaptiveTracking: AdaptiveTimer = {
  start(dbHandle: unknown) {
    activeDb = dbHandle;
    clearAdaptiveTimer();
    adaptiveHandle = setTimeout(() => void tickLoop(), 1_000);
  },
  stop() {
    clearAdaptiveTimer();
    lastPosition = null;
    activeDb = null;
  },
};
