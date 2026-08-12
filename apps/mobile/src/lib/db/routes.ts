import type { SQLiteDatabase } from "expo-sqlite";
import { api } from "../api";
import type { LocalRouteRow, LocalStopRow } from "./schema";

/**
 * Espejo del shape que devuelve `GET /api/driver/route/current`
 * (`apps/web/src/lib/services/driver.ts`). No se comparte el tipo vía
 * `@fyc/shared` a propósito por ahora: son dos apps con runtimes
 * distintos y este shape es chico — si empieza a crecer o desincronizarse
 * de verdad, ahí vale la pena moverlo (mismo criterio que
 * `enums-sync.test.ts` del lado web, ver ADR-014).
 */
interface DriverRouteResponse {
  route: {
    id: string;
    routeNumber: number;
    status: string;
    plannedDistanceM: number | null;
    plannedDurationS: number | null;
    plannedStops: number | null;
    colorHex: string | null;
  } | null;
  stops: {
    stopId: string;
    sequence: number;
    status: string;
    packageId: string;
    internalCode: string;
    trackingCode: string | null;
    bulkNumber: number | null;
    recipientName: string | null;
    recipientPhone: string | null;
    rawAddressText: string | null;
    lat: number | null;
    lng: number | null;
    operationalNotes: string | null;
    requiresPhoto: boolean;
    requiresDocument: boolean;
    priority: number;
  }[];
}

export interface DownloadRouteResult {
  downloaded: boolean;
  stopCount: number;
}

/**
 * "Descarga completa de la ruta a local" (§14 FASE 7). Reemplaza
 * completo lo que hubiera antes — un chofer solo tiene una ruta activa
 * a la vez, no hace falta merge incremental.
 */
export async function downloadCurrentRoute(
  db: SQLiteDatabase,
): Promise<DownloadRouteResult> {
  const response = await api.get<DriverRouteResponse>("/api/driver/route/current");

  await db.runAsync(`DELETE FROM local_stop`);
  await db.runAsync(`DELETE FROM local_route`);

  if (!response.route) return { downloaded: false, stopCount: 0 };

  const { route, stops } = response;
  const downloadedAt = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO local_route (id, route_number, status, planned_distance_m, planned_duration_s, planned_stops, color_hex, downloaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    route.id,
    route.routeNumber,
    route.status,
    route.plannedDistanceM,
    route.plannedDurationS,
    route.plannedStops,
    route.colorHex,
    downloadedAt,
  );

  for (const stop of stops) {
    await db.runAsync(
      `INSERT INTO local_stop (id, route_id, sequence, status, package_id, internal_code, tracking_code, bulk_number, recipient_name, recipient_phone, raw_address_text, lat, lng, operational_notes, requires_photo, requires_document, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      stop.stopId,
      route.id,
      stop.sequence,
      stop.status,
      stop.packageId,
      stop.internalCode,
      stop.trackingCode,
      stop.bulkNumber,
      stop.recipientName,
      stop.recipientPhone,
      stop.rawAddressText,
      stop.lat,
      stop.lng,
      stop.operationalNotes,
      stop.requiresPhoto ? 1 : 0,
      stop.requiresDocument ? 1 : 0,
      stop.priority,
    );
  }

  return { downloaded: true, stopCount: stops.length };
}

export async function getLocalRoute(
  db: SQLiteDatabase,
): Promise<{ route: LocalRouteRow; stops: LocalStopRow[] } | null> {
  const route = await db.getFirstAsync<LocalRouteRow>(
    `SELECT * FROM local_route LIMIT 1`,
  );
  if (!route) return null;
  const stops = await db.getAllAsync<LocalStopRow>(
    `SELECT * FROM local_stop WHERE route_id = ? ORDER BY sequence ASC`,
    route.id,
  );
  return { route, stops };
}
