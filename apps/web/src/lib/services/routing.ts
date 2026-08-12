/**
 * Matriz de distancias/tiempos reales por calle — PROMPT-MAESTRO §8, etapa
 * 2: "Obtener matriz de distancias/tiempos REALES por calle (Google Routes
 * API) → solo dentro del cluster (...) → CACHEAR agresivamente". Nunca se
 * usa para clusterizar (eso es haversine, gratis, en `@fyc/geo`) — solo
 * para secuenciar dentro de una ruta ya formada.
 *
 * Misma filosofía que `geocoding.ts`: si `GOOGLE_ROUTES_API_KEY` no está
 * configurada, degrada a una estimación (haversine con un factor de ajuste
 * por calles, NO la distancia real) en vez de tirar una excepción — permite
 * seguir desarrollando/probando el ruteo sin la API paga.
 */
import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import { haversineDistanceMeters, type LatLng } from "@fyc/geo";
import { db } from "@/lib/db";
import { routeMatrixCache } from "@/lib/db/schema";

export interface MatrixLeg {
  distanceM: number;
  durationS: number;
  /** `true` si es una estimación local (haversine × factor), no la distancia real por calle. */
  estimated: boolean;
}

/** Factor empírico camino-real/línea-recta para AMBA (calles, no autopistas) — solo para el fallback degradado. */
const ROAD_DISTANCE_FUDGE_FACTOR = 1.3;
/** Velocidad promedio urbana asumida para estimar duración en el fallback (km/h). */
const ASSUMED_URBAN_SPEED_KMH = 25;

function roundCoord(value: number): number {
  return Math.round(value * 1e5) / 1e5; // ~1m de precisión — suficiente para cachear pares
}

function pairHash(origin: LatLng, dest: LatLng): string {
  const key = `${roundCoord(origin.lat)},${roundCoord(origin.lng)}|${roundCoord(dest.lat)},${roundCoord(dest.lng)}`;
  return createHash("sha256").update(key).digest("hex");
}

interface GoogleRoutesMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  distanceMeters?: number;
  duration?: string; // "123s"
  status?: { code?: number };
}

function parseDurationSeconds(duration: string | undefined): number | null {
  if (!duration) return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(duration);
  if (!match) return null;
  return Math.round(Number(match[1]));
}

/**
 * Llama a la Route Matrix API de Google (`computeRouteMatrix`). Aislada en
 * su propia función para poder mockear `fetch` en los tests.
 */
async function callGoogleRouteMatrix(
  origins: LatLng[],
  destinations: LatLng[],
  apiKey: string,
): Promise<Map<string, { distanceM: number; durationS: number }>> {
  const body = {
    origins: origins.map((o) => ({
      waypoint: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
    })),
    destinations: destinations.map((d) => ({
      waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
    })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
  };

  const response = await fetch(
    "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "originIndex,destinationIndex,distanceMeters,duration,status",
      },
      body: JSON.stringify(body),
    },
  );

  const results = new Map<string, { distanceM: number; durationS: number }>();
  if (!response.ok) return results;

  const elements = (await response.json()) as GoogleRoutesMatrixElement[];
  for (const el of elements) {
    if (el.originIndex === undefined || el.destinationIndex === undefined) continue;
    if (el.status?.code) continue; // distinto de 0/undefined = error para ese par
    const distanceM = el.distanceMeters;
    const durationS = parseDurationSeconds(el.duration);
    if (distanceM == null || durationS == null) continue;
    const origin = origins[el.originIndex];
    const dest = destinations[el.destinationIndex];
    if (!origin || !dest) continue;
    results.set(pairHash(origin, dest), { distanceM, durationS });
  }
  return results;
}

function estimateLeg(origin: LatLng, dest: LatLng): MatrixLeg {
  const straightLineM = haversineDistanceMeters(origin, dest);
  const distanceM = straightLineM * ROAD_DISTANCE_FUDGE_FACTOR;
  const durationS = (distanceM / (ASSUMED_URBAN_SPEED_KMH * 1000)) * 3600;
  return { distanceM, durationS, estimated: true };
}

/**
 * Matriz completa `origins × destinations` (§8: "solo dentro del cluster,
 * no 120×120"), pasando por caché (`route_matrix_cache`, sin `org_id` a
 * propósito) antes de pagar la API. Índices `[i][j]` = origen i → destino j.
 */
export async function getDistanceMatrix(
  origins: LatLng[],
  destinations: LatLng[],
): Promise<MatrixLeg[][]> {
  if (origins.length === 0 || destinations.length === 0) return [];

  const pairs = origins.flatMap((o) =>
    destinations.map((d) => ({ o, d, hash: pairHash(o, d) })),
  );
  const hashes = pairs.map((p) => p.hash);

  const cached = hashes.length
    ? await db
        .select({
          pairHash: routeMatrixCache.pairHash,
          distanceM: routeMatrixCache.distanceM,
          durationS: routeMatrixCache.durationS,
        })
        .from(routeMatrixCache)
        .where(inArray(routeMatrixCache.pairHash, hashes))
    : [];
  const cacheByHash = new Map(cached.map((c) => [c.pairHash, c]));

  const missing = pairs.filter((p) => !cacheByHash.has(p.hash));
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;

  const freshResults = new Map<string, { distanceM: number; durationS: number }>();
  if (missing.length > 0 && apiKey) {
    const missingOrigins = [
      ...new Map(missing.map((p) => [pairHash(p.o, p.o), p.o])).values(),
    ];
    const missingDestinations = [
      ...new Map(missing.map((p) => [pairHash(p.d, p.d), p.d])).values(),
    ];
    const apiResults = await callGoogleRouteMatrix(
      missingOrigins,
      missingDestinations,
      apiKey,
    );
    for (const [hash, value] of apiResults) freshResults.set(hash, value);

    const rows = missing
      .map((p) => freshResults.get(p.hash))
      .map((value, idx) =>
        value
          ? {
              pairHash: missing[idx]!.hash,
              originLat: missing[idx]!.o.lat,
              originLng: missing[idx]!.o.lng,
              destLat: missing[idx]!.d.lat,
              destLng: missing[idx]!.d.lng,
              distanceM: value.distanceM,
              durationS: value.durationS,
              provider: "google",
            }
          : null,
      )
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length > 0) {
      await db.insert(routeMatrixCache).values(rows).onConflictDoNothing({
        target: routeMatrixCache.pairHash,
      });
    }
  }

  return origins.map((o) =>
    destinations.map((d) => {
      const hash = pairHash(o, d);
      const fromCache = cacheByHash.get(hash);
      if (fromCache?.distanceM != null && fromCache.durationS != null) {
        return {
          distanceM: fromCache.distanceM,
          durationS: fromCache.durationS,
          estimated: false,
        };
      }
      const fresh = freshResults.get(hash);
      if (fresh)
        return {
          distanceM: fresh.distanceM,
          durationS: fresh.durationS,
          estimated: false,
        };
      return estimateLeg(o, d);
    }),
  );
}

/**
 * Búsqueda `(a, b) → MatrixLeg` sobre una matriz ya resuelta (evita
 * llamadas N² a la red durante el 2-opt — la matriz se pide una sola vez
 * por cluster). `sequenceRoute()` de `@fyc/geo` solo necesita la distancia;
 * la duración se recupera aparte con la misma función al reconstruir la
 * secuencia final (ver `route-planning.ts`).
 */
export function matrixLookup(
  points: LatLng[],
  matrix: MatrixLeg[][],
): (a: LatLng, b: LatLng) => MatrixLeg {
  const indexOf = (p: LatLng): number =>
    points.findIndex((q) => q.lat === p.lat && q.lng === p.lng);
  return (a, b) => {
    const i = indexOf(a);
    const j = indexOf(b);
    const found = i === -1 || j === -1 ? undefined : matrix[i]?.[j];
    return found ?? estimateLeg(a, b);
  };
}

/** Atajo sobre `matrixLookup` para cuando solo hace falta la distancia (inyectar en `sequenceRoute`). */
export function distanceFnFromMatrix(
  points: LatLng[],
  matrix: MatrixLeg[][],
): (a: LatLng, b: LatLng) => number {
  const lookup = matrixLookup(points, matrix);
  return (a, b) => lookup(a, b).distanceM;
}
