import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { knownAddresses, packages, routes, routeStops } from "@/lib/db/schema";

/**
 * Estados de ruta que cuentan como "la mía activa hoy" — no
 * DRAFT/PROPOSED (todavía no es del chofer) ni COMPLETED/CANCELLED (ya
 * terminó). `APPROVED` sigue acá a propósito AUNQUE FASE 9 ya implementó
 * la custodia (APPROVED→ASSIGNED): §9.3 dice "chofer abre la app → ve su
 * ruta asignada" ANTES de escanear el contenedor — la app tiene que poder
 * descargar la ruta la noche/mañana previa a la custodia, y ese flujo
 * sigue siendo APPROVED (ver docs/DECISIONES.md FASE 9).
 */
export const ACTIVE_ROUTE_STATUSES = [
  "APPROVED",
  "ASSIGNED",
  "LOADING",
  "LOADED",
  "IN_TRANSIT",
] as const;

export interface DriverStopItem {
  stopId: string;
  sequence: number;
  status: string;
  plannedArrival: Date | null;
  distanceFromPrevM: number | null;
  durationFromPrevS: number | null;
  packageId: string;
  internalCode: string;
  trackingCode: string | null;
  bulkNumber: number | null;
  recipientName: string | null;
  recipientPhone: string | null;
  rawAddressText: string | null;
  requiresPhoto: boolean;
  requiresDocument: boolean;
  priority: number;
  lat: number | null;
  lng: number | null;
  operationalNotes: string | null;
}

export interface DriverCurrentRoute {
  route: typeof routes.$inferSelect | null;
  stops: DriverStopItem[];
}

/**
 * Ruta activa del chofer con todas sus paradas (§14 FASE 7: "descarga
 * completa de la ruta a local"). Todo lo que la app necesita para operar
 * offline el resto del día: dirección, contacto, coordenadas, notas
 * operativas ("timbre no anda", §9.5) — cero llamadas de red adicionales
 * durante el reparto.
 */
export async function getDriverCurrentRoute(
  orgId: string,
  driverId: string,
): Promise<DriverCurrentRoute> {
  const [route] = await db
    .select()
    .from(routes)
    .where(
      and(
        eq(routes.orgId, orgId),
        eq(routes.assignedDriverId, driverId),
        inArray(routes.status, ACTIVE_ROUTE_STATUSES),
        isNull(routes.deletedAt),
      ),
    )
    .orderBy(desc(routes.createdAt))
    .limit(1);

  if (!route) return { route: null, stops: [] };

  const stops = await db
    .select({
      stopId: routeStops.id,
      sequence: routeStops.sequence,
      status: routeStops.status,
      plannedArrival: routeStops.plannedArrival,
      distanceFromPrevM: routeStops.distanceFromPrevM,
      durationFromPrevS: routeStops.durationFromPrevS,
      packageId: packages.id,
      internalCode: packages.internalCode,
      trackingCode: packages.trackingCode,
      bulkNumber: packages.bulkNumber,
      recipientName: packages.recipientName,
      recipientPhone: packages.recipientPhone,
      rawAddressText: packages.rawAddressText,
      requiresPhoto: packages.requiresPhoto,
      requiresDocument: packages.requiresDocument,
      priority: packages.priority,
      lat: knownAddresses.lat,
      lng: knownAddresses.lng,
      operationalNotes: knownAddresses.operationalNotes,
    })
    .from(routeStops)
    .innerJoin(packages, eq(packages.id, routeStops.packageId))
    .leftJoin(knownAddresses, eq(knownAddresses.id, packages.addressId))
    .where(eq(routeStops.routeId, route.id))
    .orderBy(asc(routeStops.sequence));

  return { route, stops };
}
