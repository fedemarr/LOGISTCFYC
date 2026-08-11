/**
 * Utilidades geográficas — PROMPT-MAESTRO §8.
 *
 * FASE 1 incluye solo `haversineDistanceMeters`: es una fórmula pura, sin
 * decisiones de negocio, y la necesitan varias fases tempranas (detección
 * de bounding box, tests). El clustering (k-means capacitado + DBSCAN de
 * outliers) y la secuenciación (nearest neighbor + 2-opt) son alcance de
 * FASE 6, cuando exista el modelo de datos y paquetes reales para operar.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Distancia en línea recta entre dos puntos, en metros. Gratis, local. */
export function haversineDistanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Clustering geográfico capacitado (k-means++ con restricción de capacidad
 * por vehículo) + detección de outliers con DBSCAN. Implementación: FASE 6.
 */
export function clusterPackages(): never {
  throw new Error("clusterPackages() no está implementado todavía (FASE 6).");
}

/**
 * Secuenciación dentro de una ruta ya formada (nearest neighbor + 2-opt).
 * Implementación: FASE 6.
 */
export function sequenceRoute(): never {
  throw new Error("sequenceRoute() no está implementado todavía (FASE 6).");
}
