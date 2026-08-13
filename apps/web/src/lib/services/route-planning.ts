/**
 * Ruteo — PROMPT-MAESTRO §8, etapas 1 y 2 aplicadas a datos reales +
 * persistencia. La lógica pura (clustering, secuenciación) vive en
 * `@fyc/geo`; acá solo se arma el input (paquetes geocodificados,
 * vehículos disponibles), se pide la matriz de distancias reales
 * (`routing.ts`) y se escribe el resultado (`routes` + `route_stops`).
 *
 * Etapa 3 (ajuste humano) es lo que expone `reassignPackageRoute()` y
 * `approveRoute()` — el algoritmo PROPONE, el dispatcher DISPONE (§8).
 */
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { clusterPackages, sequenceRoute, type LatLng } from "@fyc/geo";
import type { Role } from "@fyc/shared";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import {
  knownAddresses,
  operations,
  organizations,
  packages,
  routes,
  routeStops,
  vehicles,
} from "@/lib/db/schema";
import { getDistanceMatrix, matrixLookup } from "./routing";
import { runPackageTransition } from "./state-machine";

/** Capacidad asumida si el vehículo no tiene `capacity_packages` cargado (§8: referencia de "40 paradas"). */
const DEFAULT_VEHICLE_CAPACITY = 40;

/**
 * Paleta de rutas — 12 colores fijos por índice (PROMPT-FRONTEND-V2 §2),
 * identidad de la ruta en todo el sistema: panel, mapa, app del chofer y
 * la banda de la etiqueta impresa (§9.2). Debe ser un espejo literal de
 * `--route-1..12` en `@fyc/config/tailwind/tokens.css` — no se importa el
 * CSS acá porque este archivo corre en el servidor (generación de la
 * propuesta y del PDF), no en el navegador.
 */
const ROUTE_COLORS = [
  "#0EA5E9",
  "#A855F7",
  "#22C55E",
  "#EAB308",
  "#F97316",
  "#EC4899",
  "#14B8A6",
  "#6366F1",
  "#84CC16",
  "#F43F5E",
  "#06B6D4",
  "#8B5CF6",
];

/**
 * Ubicación del depósito (§9.2, punto de partida de toda ruta). No está en
 * el modelo de datos del documento madre como columna dedicada — se
 * resuelve desde `organizations.settings.depot` si está cargado, si no
 * desde `DEFAULT_DEPOT_LAT`/`DEFAULT_DEPOT_LNG` (`.env`). Si ninguno está
 * configurado, falla explícito en vez de inventar una coordenada (ver
 * docs/DECISIONES.md ADR-033) — es un dato de negocio real, no algo que se
 * pueda adivinar.
 */
export async function resolveDepotLocation(orgId: string): Promise<LatLng> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw Errors.notFound("organización no encontrada");

  const settings = org.settings as { depot?: { lat?: number; lng?: number } } | null;
  if (
    settings?.depot?.lat != null &&
    settings.depot.lng != null &&
    Number.isFinite(settings.depot.lat) &&
    Number.isFinite(settings.depot.lng)
  ) {
    return { lat: settings.depot.lat, lng: settings.depot.lng };
  }

  const envLat = Number(process.env.DEFAULT_DEPOT_LAT);
  const envLng = Number(process.env.DEFAULT_DEPOT_LNG);
  if (
    Number.isFinite(envLat) &&
    Number.isFinite(envLng) &&
    process.env.DEFAULT_DEPOT_LAT
  ) {
    return { lat: envLat, lng: envLng };
  }

  throw Errors.validation(
    "falta configurar la ubicación del depósito (organizations.settings.depot o DEFAULT_DEPOT_LAT/DEFAULT_DEPOT_LNG en .env) antes de generar rutas",
  );
}

interface GeocodedPackage {
  id: string;
  lat: number;
  lng: number;
}

async function fetchGeocodedPackages(
  orgId: string,
  operationId: string,
): Promise<GeocodedPackage[]> {
  const rows = await db
    .select({
      id: packages.id,
      lat: knownAddresses.lat,
      lng: knownAddresses.lng,
    })
    .from(packages)
    .innerJoin(knownAddresses, eq(knownAddresses.id, packages.addressId))
    .where(
      and(
        eq(packages.orgId, orgId),
        eq(packages.operationId, operationId),
        eq(packages.status, "GEOCODIFICADO"),
        isNull(packages.routeId),
        isNull(packages.deletedAt),
      ),
    );

  return rows.filter((r): r is GeocodedPackage => r.lat != null && r.lng != null);
}

interface AvailableVehicle {
  vehicleId: string;
  driverId: string;
  capacity: number;
}

/**
 * Vehículos AVAILABLE con chofer, EXCLUYENDO los que ya están en una ruta
 * activa de ESTA operación — necesario desde que `generateRouteProposal`
 * se puede correr más de una vez por operación (§8: "agregar ruta" sobre
 * paquetes que llegaron después de la primera tanda). Sin este filtro, un
 * mismo chofer/vehículo podría terminar con dos rutas simultáneas el
 * mismo día. `vehicles.status` no cambia a `IN_ROUTE` hasta que el chofer
 * arranca de verdad (§9.4) — DRAFT/APPROVED/ASSIGNED todavía lo muestran
 * como AVAILABLE, por eso hace falta este chequeo aparte.
 */
async function fetchAvailableVehicles(
  orgId: string,
  operationId: string,
): Promise<AvailableVehicle[]> {
  const busy = await db
    .select({ vehicleId: routes.vehicleId })
    .from(routes)
    .where(
      and(
        eq(routes.orgId, orgId),
        eq(routes.operationId, operationId),
        isNull(routes.deletedAt),
        ne(routes.status, "CANCELLED"),
      ),
    );
  const busyVehicleIds = new Set(
    busy.map((r) => r.vehicleId).filter((id): id is string => id != null),
  );

  const rows = await db
    .select({
      id: vehicles.id,
      assignedDriverId: vehicles.assignedDriverId,
      capacityPackages: vehicles.capacityPackages,
    })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.orgId, orgId),
        eq(vehicles.status, "AVAILABLE"),
        isNull(vehicles.deletedAt),
      ),
    );

  return rows
    .filter((r) => !busyVehicleIds.has(r.id))
    .filter(
      (r): r is typeof r & { assignedDriverId: string } => r.assignedDriverId != null,
    )
    .map((r) => ({
      vehicleId: r.id,
      driverId: r.assignedDriverId,
      capacity: r.capacityPackages ?? DEFAULT_VEHICLE_CAPACITY,
    }));
}

/** Duración total de un tour ya secuenciado, usando la matriz real (no la distancia de `sequenceRoute`, que es solo métrica de optimización). */
function tourDurationS(
  depot: LatLng,
  orderedPoints: LatLng[],
  lookup: (a: LatLng, b: LatLng) => { durationS: number },
): number {
  let total = 0;
  let prev = depot;
  for (const p of orderedPoints) {
    total += lookup(prev, p).durationS;
    prev = p;
  }
  return total;
}

export interface GenerateRouteProposalResult {
  routes: Array<{
    routeId: string;
    routeNumber: number;
    packageCount: number;
    plannedDistanceM: number;
    plannedDurationS: number;
  }>;
  outlierPackageIds: string[];
  unassignedForLackOfCapacity: number;
}

/**
 * Corre las etapas 1 y 2 de §8 sobre los paquetes GEOCODIFICADO de una
 * operación y persiste el resultado como rutas `DRAFT` — la propuesta que
 * el dispatcher ajusta a mano antes de aprobar (etapa 3).
 */
export async function generateRouteProposal(
  orgId: string,
  operationId: string,
): Promise<GenerateRouteProposalResult> {
  const [operation] = await db
    .select()
    .from(operations)
    .where(and(eq(operations.id, operationId), eq(operations.orgId, orgId)));
  if (!operation) throw Errors.notFound("operación no encontrada");

  const depot = await resolveDepotLocation(orgId);
  // Solo paquetes SIN ruta todavía (`fetchGeocodedPackages` filtra por
  // `routeId IS NULL`) — esto es lo que hace que correr esta función de
  // nuevo sobre una operación que YA tiene rutas agregue una ruta más con
  // los paquetes que llegaron/geocodificaron después, en vez de re-rutear
  // todo desde cero (§8: "agregar ruta").
  const geocoded = await fetchGeocodedPackages(orgId, operationId);
  if (geocoded.length === 0) {
    throw Errors.validation(
      "no hay paquetes GEOCODIFICADO sin asignar a una ruta en esta operación — corré el geocoding de /deposito primero, o ya están todos ruteados",
    );
  }

  const vehicleList = await fetchAvailableVehicles(orgId, operationId);
  if (vehicleList.length === 0) {
    throw Errors.validation(
      "no hay vehículos AVAILABLE con chofer asignado y sin ruta activa en esta operación",
    );
  }

  const clusterResult = clusterPackages(
    geocoded.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng })),
    { capacities: vehicleList.map((v) => v.capacity) },
  );

  const byId = new Map(geocoded.map((p) => [p.id, p]));
  const result: GenerateRouteProposalResult = {
    routes: [],
    outlierPackageIds: clusterResult.outlierIds,
    unassignedForLackOfCapacity: 0,
  };

  // Sigue la numeración existente en vez de reiniciar en 1 — dos rutas
  // "RUTA 001" en la misma operación sería confuso en el panel/etiquetas.
  const [maxRoute] = await db
    .select({ n: routes.routeNumber })
    .from(routes)
    .where(and(eq(routes.orgId, orgId), eq(routes.operationId, operationId)))
    .orderBy(desc(routes.routeNumber))
    .limit(1);
  let routeNumber = (maxRoute?.n ?? 0) + 1;
  for (let i = 0; i < clusterResult.clusters.length; i++) {
    const cluster = clusterResult.clusters[i];
    if (!cluster || cluster.pointIds.length === 0) continue;
    const vehicle = vehicleList[i];
    if (!vehicle) continue;

    const clusterPoints = cluster.pointIds
      .map((id) => byId.get(id))
      .filter((p): p is GeocodedPackage => p != null);

    const allPoints: LatLng[] = [depot, ...clusterPoints];
    const matrix = await getDistanceMatrix(allPoints, allPoints);
    const lookup = matrixLookup(allPoints, matrix);

    const sequence = sequenceRoute(
      depot,
      clusterPoints.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng })),
      { distanceFn: (a, b) => lookup(a, b).distanceM },
    );

    const orderedPackages = sequence.orderedIds
      .map((id) => byId.get(id))
      .filter((p): p is GeocodedPackage => p != null);
    const plannedDurationS = tourDurationS(depot, orderedPackages, lookup);

    const [route] = await db
      .insert(routes)
      .values({
        orgId,
        operationId,
        routeNumber,
        status: "DRAFT",
        assignedDriverId: vehicle.driverId,
        vehicleId: vehicle.vehicleId,
        plannedDistanceM: sequence.totalDistanceM,
        plannedDurationS: Math.round(plannedDurationS),
        plannedStops: orderedPackages.length,
        colorHex: ROUTE_COLORS[(routeNumber - 1) % ROUTE_COLORS.length],
      })
      .returning();
    if (!route) throw Errors.internal("no se pudo crear la ruta");

    let prev: LatLng = depot;
    let seq = 0;
    for (const pkg of orderedPackages) {
      const leg = lookup(prev, pkg);
      await db.insert(routeStops).values({
        routeId: route.id,
        packageId: pkg.id,
        sequence: seq,
        distanceFromPrevM: leg.distanceM,
        durationFromPrevS: Math.round(leg.durationS),
        status: "PENDING",
      });
      await db
        .update(packages)
        .set({ routeId: route.id, updatedAt: new Date() })
        .where(eq(packages.id, pkg.id));
      prev = pkg;
      seq++;
    }

    result.routes.push({
      routeId: route.id,
      routeNumber,
      packageCount: orderedPackages.length,
      plannedDistanceM: sequence.totalDistanceM,
      plannedDurationS: Math.round(plannedDurationS),
    });
    routeNumber++;
  }

  const assignedCount = result.routes.reduce((sum, r) => sum + r.packageCount, 0);
  result.unassignedForLackOfCapacity =
    geocoded.length - assignedCount - result.outlierPackageIds.length;

  return result;
}

/** Vuelve a secuenciar una ruta ya creada (después de mover paquetes) — recalcula distancia/tiempo "en vivo" (§8, etapa 3). */
async function resequenceRoute(orgId: string, routeId: string): Promise<void> {
  const [route] = await db.select().from(routes).where(eq(routes.id, routeId));
  if (!route) throw Errors.notFound("ruta no encontrada");

  const depot = await resolveDepotLocation(orgId);
  const members = await db
    .select({ id: packages.id, lat: knownAddresses.lat, lng: knownAddresses.lng })
    .from(packages)
    .innerJoin(knownAddresses, eq(knownAddresses.id, packages.addressId))
    .where(eq(packages.routeId, routeId));
  const points = members.filter(
    (p): p is GeocodedPackage => p.lat != null && p.lng != null,
  );

  await db.delete(routeStops).where(eq(routeStops.routeId, routeId));

  if (points.length === 0) {
    await db
      .update(routes)
      .set({
        plannedDistanceM: 0,
        plannedDurationS: 0,
        plannedStops: 0,
        updatedAt: new Date(),
      })
      .where(eq(routes.id, routeId));
    return;
  }

  const allPoints: LatLng[] = [depot, ...points];
  const matrix = await getDistanceMatrix(allPoints, allPoints);
  const lookup = matrixLookup(allPoints, matrix);
  const sequence = sequenceRoute(depot, points, {
    distanceFn: (a, b) => lookup(a, b).distanceM,
  });

  const byId = new Map(points.map((p) => [p.id, p]));
  const orderedPackages = sequence.orderedIds
    .map((id) => byId.get(id))
    .filter((p): p is GeocodedPackage => p != null);
  const plannedDurationS = tourDurationS(depot, orderedPackages, lookup);

  let prev: LatLng = depot;
  let seq = 0;
  for (const pkg of orderedPackages) {
    const leg = lookup(prev, pkg);
    await db.insert(routeStops).values({
      routeId,
      packageId: pkg.id,
      sequence: seq,
      distanceFromPrevM: leg.distanceM,
      durationFromPrevS: Math.round(leg.durationS),
      status: "PENDING",
    });
    prev = pkg;
    seq++;
  }

  await db
    .update(routes)
    .set({
      plannedDistanceM: sequence.totalDistanceM,
      plannedDurationS: Math.round(plannedDurationS),
      plannedStops: orderedPackages.length,
      updatedAt: new Date(),
    })
    .where(eq(routes.id, routeId));
}

/**
 * Ajuste manual (§8, etapa 3): mover un paquete de una ruta a otra.
 * Ambas rutas deben seguir `DRAFT`/`PROPOSED` — una vez `APPROVED` el
 * bulto está impreso y moverlo rompería la identidad física (§7).
 */
export async function reassignPackageRoute(
  orgId: string,
  packageId: string,
  toRouteId: string,
): Promise<void> {
  const [pkg] = await db
    .select()
    .from(packages)
    .where(and(eq(packages.id, packageId), eq(packages.orgId, orgId)));
  if (!pkg) throw Errors.notFound("paquete no encontrado");
  if (!pkg.routeId)
    throw Errors.validation("el paquete no está asignado a ninguna ruta todavía");

  const [fromRoute, toRoute] = await Promise.all([
    db
      .select()
      .from(routes)
      .where(eq(routes.id, pkg.routeId))
      .then((r) => r[0]),
    db
      .select()
      .from(routes)
      .where(and(eq(routes.id, toRouteId), eq(routes.orgId, orgId)))
      .then((r) => r[0]),
  ]);
  if (!toRoute) throw Errors.notFound("ruta de destino no encontrada");
  if (!fromRoute) throw Errors.notFound("ruta de origen no encontrada");
  if (fromRoute.id === toRoute.id) return;
  for (const r of [fromRoute, toRoute]) {
    if (r.status !== "DRAFT" && r.status !== "PROPOSED") {
      throw Errors.conflict(
        `la ruta ${r.routeNumber} ya está ${r.status} — no se puede reasignar bultos después de aprobar`,
      );
    }
  }

  await db
    .update(packages)
    .set({ routeId: toRoute.id, updatedAt: new Date() })
    .where(eq(packages.id, packageId));

  await resequenceRoute(orgId, fromRoute.id);
  await resequenceRoute(orgId, toRoute.id);
}

export interface ApproveRouteResult {
  routeId: string;
  status: "APPROVED";
  packageCount: number;
}

/**
 * APROBAR (§8, etapa 3 / §9.2): congela `bulk_number` (1..n según la
 * secuencia final) y transiciona cada paquete GEOCODIFICADO → ASIGNADO.
 * A partir de acá el número de bulto de la etiqueta ya impresa NUNCA
 * cambia, aunque `route_stops.sequence` se siga recalculando (§7).
 */
export async function approveRoute(
  orgId: string,
  routeId: string,
  actor: { userId: string; roles: readonly Role[] },
): Promise<ApproveRouteResult> {
  const [route] = await db
    .select()
    .from(routes)
    .where(and(eq(routes.id, routeId), eq(routes.orgId, orgId)));
  if (!route) throw Errors.notFound("ruta no encontrada");
  if (route.status !== "DRAFT" && route.status !== "PROPOSED") {
    throw Errors.conflict(`la ruta ya está ${route.status}`);
  }

  const stops = await db
    .select({ packageId: routeStops.packageId, sequence: routeStops.sequence })
    .from(routeStops)
    .where(eq(routeStops.routeId, routeId))
    .orderBy(asc(routeStops.sequence));
  if (stops.length === 0)
    throw Errors.validation("la ruta no tiene paradas — no hay nada que aprobar");

  await db.transaction(async (tx) => {
    for (const [idx, stop] of stops.entries()) {
      await tx
        .update(packages)
        .set({ bulkNumber: idx + 1, updatedAt: new Date() })
        .where(eq(packages.id, stop.packageId));
    }
    await tx
      .update(routes)
      .set({ status: "APPROVED", updatedAt: new Date() })
      .where(eq(routes.id, routeId));
  });

  // Fuera de la transacción anterior — mismo patrón que `scanPackage()`
  // (ver docs/DECISIONES.md): `runPackageTransition` abre su propia
  // transacción, anidarla causaría deadlock de locks entre conexiones.
  const packageIds = stops.map((s) => s.packageId);
  const currentStatuses = await db
    .select({ id: packages.id, status: packages.status })
    .from(packages)
    .where(inArray(packages.id, packageIds));
  for (const p of currentStatuses) {
    if (p.status !== "GEOCODIFICADO") continue; // ya transicionado o en excepción — no reintentar a ciegas
    await runPackageTransition({
      packageId: p.id,
      toStatus: "ASIGNADO",
      actorId: actor.userId,
      actorRoles: actor.roles,
      metadata: { routeId },
    });
  }

  return { routeId, status: "APPROVED", packageCount: stops.length };
}
