/**
 * Distancia en línea recta entre dos puntos (haversine), en metros.
 * Espejo local de `@fyc/geo` para la app del chofer (el paquete @fyc/geo
 * no está en las dependencias de mobile a propósito — ver ADR-014, mismo
 * criterio que `db/routes.ts`). Se usa para el anti-fraude de §9.5
 * (`distanceFromTargetM`) y para decidir la frecuencia de tracking §10.
 */
export function haversineDistanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
