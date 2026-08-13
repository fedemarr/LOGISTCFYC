/**
 * ENTREGA Y EVIDENCIA — PROMPT-MAESTRO §9.5-§9.9 (FASE 10).
 *
 * Implementa las acciones del motor de sync del chofer en la calle. Cada
 * función es el efecto de negocio de un `operationType` del outbox (ver
 * `sync.ts`), es idempotente, y NUNCA se invoca con estados de ruta que
 * no correspondan (todo valida que la ruta sea del chofer y esté
 * IN_TRANSIT, salvo el reorden que acepta cualquier ruta activa).
 *
 *   1. `arriveAtStop`        — STOP_ARRIVED: marca la parada ARRIVED y
 *                              paquete EN_REPARTO → EN_DOMICILIO.
 *   2. `recordDelivery`      — DELIVERY_DELIVERED: inserta la fila de
 *                              `deliveries`, transiciona → ENTREGADO,
 *                              parada COMPLETED, memoria de dirección +1.
 *   3. `reportDeliveryFailed`— DELIVERY_FAILED: incidente + EN_DOMICILIO →
 *                              FALLA_REPORTADA, parada FAILED.
 *   4. `reorderStops`        — STOPS_REORDERED: re-secuenciación manual.
 *   5. `attachDeliveryPhoto` — DELIVERY_PHOTO_ATTACH: adjunta una foto que
 *                              subió después (offline-first).
 *   6. `finishRoute`         — ROUTE_FINISHED: IN_TRANSIT → COMPLETED,
 *                              vehículo AVAILABLE (§9.9).
 *
 * Regla de oro §3: SOLO el chofer que tiene la ruta activa ejecuta estas
 * acciones — se valida con `getDriverActiveRoute` en cada una.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import {
  deliveries,
  incidents,
  knownAddresses,
  packages,
  routes,
  routeStops,
  vehicles,
} from "@/lib/db/schema";
import { logDomainEvent } from "./events";
import { runPackageTransition } from "./state-machine";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const MAX_DELIVERY_DISTANCE_M = Number(process.env.MAX_DELIVERY_DISTANCE_M ?? 150);

/** Rutas en las que el chofer puede llegar/entregar/reportar/finalizar. */
const DELIVERY_ROUTE_STATUSES = ["IN_TRANSIT"] as const;

/** Rutas en las que el chofer puede reordenar paradas (antes o durante el reparto). */
const REORDER_ROUTE_STATUSES = ["ASSIGNED", "LOADING", "LOADED", "IN_TRANSIT"] as const;

export interface ArriveAtStopInput {
  routeId: string;
  stopId: string;
  arrivedAt: string;
}

export interface RecordDeliveryInput {
  routeId: string;
  stopId: string;
  receiverName: string;
  receiverRelationship?: string;
  distanceFromTargetM: number;
  lat: number;
  lng: number;
  gpsAccuracyM?: number;
  photoUrls: string[];
  deliveryKey: string;
  deviceId?: string;
  deliveredAt: string;
}

export interface ReportDeliveryFailedInput {
  routeId: string;
  stopId: string;
  reason: string;
  comment?: string;
  photoUrls?: string[];
  lat?: number;
  lng?: number;
  deviceId?: string;
  reportedAt: string;
}

export interface ReorderStopsInput {
  routeId: string;
  orderedStopIds: string[];
  reorderedAt: string;
}

export interface AttachDeliveryPhotoInput {
  routeId: string;
  stopId: string;
  deliveryKey: string;
  photoUrl: string;
  attachedAt: string;
}

export interface FinishRouteInput {
  routeId: string;
  finishedAt: string;
  finalLat?: number;
  finalLng?: number;
}

async function getDriverRoute(
  orgId: string,
  driverId: string,
  statuses: readonly (typeof routes.$inferSelect.status)[],
  routeId?: string,
): Promise<typeof routes.$inferSelect> {
  const rows = await db
    .select()
    .from(routes)
    .where(
      and(
        eq(routes.orgId, orgId),
        eq(routes.assignedDriverId, driverId),
        inArray(routes.status, statuses),
        isNull(routes.deletedAt),
        ...(routeId ? [eq(routes.id, routeId)] : []),
      ),
    )
    .orderBy(desc(routes.createdAt))
    .limit(1);
  const route = rows[0];
  if (!route) {
    throw Errors.conflict(
      routeId
        ? "la ruta no existe, no es tuya o ya no está activa"
        : "no tenés una ruta activa para esta operación",
    );
  }
  return route;
}

/** El paquete de la parada, con la dirección a la que apunta (para la memoria de direcciones). */
async function getStopWithPackage(
  orgId: string,
  routeId: string,
  stopId: string,
): Promise<{ stop: typeof routeStops.$inferSelect; pkg: typeof packages.$inferSelect }> {
  const rows = await db
    .select({ stop: routeStops, pkg: packages })
    .from(routeStops)
    .innerJoin(routes, eq(routes.id, routeStops.routeId))
    .innerJoin(packages, eq(packages.id, routeStops.packageId))
    .where(
      and(
        eq(routeStops.id, stopId),
        eq(routeStops.routeId, routeId),
        eq(routes.orgId, orgId),
      ),
    );
  const row = rows[0];
  if (!row) {
    throw Errors.notFound("la parada no pertenece a esta ruta");
  }
  return { stop: row.stop, pkg: row.pkg };
}

async function setStopStatus(params: {
  stop: typeof routeStops.$inferSelect;
  toStatus: "ARRIVED" | "COMPLETED" | "FAILED";
  actualArrival?: Date;
  tx: Tx;
}): Promise<void> {
  const { stop, toStatus, actualArrival, tx } = params;
  await tx
    .update(routeStops)
    .set({
      status: toStatus,
      ...(actualArrival ? { actualArrival } : {}),
      updatedAt: new Date(),
    })
    .where(eq(routeStops.id, stop.id));
}

async function setVehicleStatus(params: {
  orgId: string;
  vehicle: typeof vehicles.$inferSelect;
  toStatus: string;
  actorId: string;
  actorRole: string;
  occurredAt: Date;
  tx: Tx;
}): Promise<void> {
  const { orgId, vehicle, toStatus, actorId, actorRole, occurredAt, tx } = params;
  await tx
    .update(vehicles)
    .set({
      status: toStatus as typeof vehicles.$inferSelect.status,
      updatedAt: occurredAt,
    })
    .where(and(eq(vehicles.id, vehicle.id), eq(vehicles.orgId, orgId)));
  await logDomainEvent(
    {
      orgId,
      entityType: "VEHICLE",
      entityId: vehicle.id,
      eventType: "VEHICLE_STATUS_CHANGED",
      actorId,
      actorRole,
      fromStatus: vehicle.status,
      toStatus,
      occurredAt,
    },
    tx,
  );
}

/** Lleva el paquete a EN_DOMICILIO si está EN_REPARTO (idempotente). */
async function ensureAtDomicile(
  driverId: string,
  pkg: typeof packages.$inferSelect,
  routeId: string,
  stopId: string,
): Promise<void> {
  if (pkg.status === "EN_DOMICILIO") return;
  if (pkg.status !== "EN_REPARTO") {
    throw Errors.conflict(
      `el bulto ${pkg.internalCode} está ${pkg.status} — no se puede llegar a la parada`,
    );
  }
  await runPackageTransition({
    packageId: pkg.id,
    toStatus: "EN_DOMICILIO",
    actorId: driverId,
    actorRoles: ["driver"],
    metadata: { routeId, stopId },
  });
}

/**
 * STOP_ARRIVED — §9.5. El chofer llega a la parada: se marca ARRIVED (con
 * hora real del dispositivo) y el paquete pasa EN_REPARTO → EN_DOMICILIO.
 * Reenviar es seguro: si el paquete ya está EN_DOMICILIO/ENTREGADO, no hace nada.
 */
export async function arriveAtStop(
  orgId: string,
  driverId: string,
  input: ArriveAtStopInput,
): Promise<void> {
  const route = await getDriverRoute(
    orgId,
    driverId,
    DELIVERY_ROUTE_STATUSES,
    input.routeId,
  );
  const { stop, pkg } = await getStopWithPackage(orgId, input.routeId, input.stopId);
  const arrivedAt = new Date(input.arrivedAt);

  await ensureAtDomicile(driverId, pkg, route.id, stop.id);

  await db.transaction(async (tx) => {
    await setStopStatus({ stop, toStatus: "ARRIVED", actualArrival: arrivedAt, tx });
    await logDomainEvent(
      {
        orgId,
        entityType: "ROUTE",
        entityId: route.id,
        eventType: "STOP_ARRIVED",
        actorId: driverId,
        actorRole: "driver",
        toStatus: "ARRIVED",
        metadata: { stopId: stop.id, sequence: stop.sequence },
        occurredAt: arrivedAt,
      },
      tx,
    );
  });
}

/**
 * DELIVERY_DELIVERED — §9.5/§9.6. La entrega real: inserta la fila de
 * `deliveries` con toda la evidencia (receiverName + GPS obligatorios, foto
 * según política), transiciona EN_DOMICILIO → ENTREGADO (precondición de
 * evidencia de la máquina de estados), marca la parada COMPLETED y suma a
 * la memoria de direcciones.
 *
 * Anti-fraude §9.5: `distanceFromTargetM > 150` no bloquea la entrega (el
 * chofer ya confirmó explícitamente en la app) pero queda marcado en el
 * evento de dominio para que la bandeja del dispatcher la revise.
 *
 * Idempotente por `deliveryKey` (deliveries.idempotency_key unique): si el
 * mismo envío llega dos veces, el segundo se detecta y no re-aplica el
 * efecto (el outbox del servidor ya lo dedupe, pero esto cubre reenvíos
 * fuera del outbox).
 */
export async function recordDelivery(
  orgId: string,
  driverId: string,
  input: RecordDeliveryInput,
): Promise<{ deliveryId: string }> {
  const route = await getDriverRoute(
    orgId,
    driverId,
    DELIVERY_ROUTE_STATUSES,
    input.routeId,
  );
  const { stop, pkg } = await getStopWithPackage(orgId, input.routeId, input.stopId);
  const deliveredAt = new Date(input.deliveredAt);

  const [existing] = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(
      and(eq(deliveries.orgId, orgId), eq(deliveries.idempotencyKey, input.deliveryKey)),
    );
  if (existing) return { deliveryId: existing.id };

  if (!input.receiverName.trim()) {
    throw Errors.validation("el nombre de quien recibe es obligatorio (§9.6)");
  }
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    throw Errors.validation("la ubicación GPS de la entrega es obligatoria (§9.6)");
  }

  await ensureAtDomicile(driverId, pkg, route.id, stop.id);

  const requiresReview = input.distanceFromTargetM > MAX_DELIVERY_DISTANCE_M;

  const [delivery] = await db
    .insert(deliveries)
    .values({
      orgId,
      packageId: pkg.id,
      routeId: route.id,
      driverId,
      vehicleId: route.vehicleId,
      outcome: "DELIVERED",
      receiverName: input.receiverName.trim(),
      receiverRelationship: input.receiverRelationship?.trim() || null,
      photoUrls: input.photoUrls,
      lat: input.lat,
      lng: input.lng,
      gpsAccuracyM: input.gpsAccuracyM ?? null,
      distanceFromTargetM: input.distanceFromTargetM,
      deliveredAt,
      deviceId: input.deviceId ?? null,
      idempotencyKey: input.deliveryKey,
      offlineCreated: new Date(input.deliveredAt).getTime() < Date.now() - 60_000,
    })
    .onConflictDoNothing({ target: deliveries.idempotencyKey })
    .returning({ id: deliveries.id });

  if (!delivery) {
    const [recheck] = await db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.orgId, orgId),
          eq(deliveries.idempotencyKey, input.deliveryKey),
        ),
      );
    return { deliveryId: recheck!.id };
  }

  await runPackageTransition({
    packageId: pkg.id,
    toStatus: "ENTREGADO",
    actorId: driverId,
    actorRoles: ["driver"],
    metadata: {
      routeId: route.id,
      stopId: stop.id,
      receiverName: input.receiverName.trim(),
      receiverRelationship: input.receiverRelationship?.trim() ?? null,
      gps: { lat: input.lat, lng: input.lng },
      distanceFromTargetM: input.distanceFromTargetM,
      photoUrl: input.photoUrls[0] ?? null,
      requiresReview,
      deliveryId: delivery.id,
    },
  });

  await db.transaction(async (tx) => {
    await setStopStatus({ stop, toStatus: "COMPLETED", tx });
    await logDomainEvent(
      {
        orgId,
        entityType: "DELIVERY",
        entityId: delivery.id,
        eventType: "DELIVERY_COMPLETED",
        actorId: driverId,
        actorRole: "driver",
        fromStatus: "EN_DOMICILIO",
        toStatus: "ENTREGADO",
        lat: input.lat,
        lng: input.lng,
        metadata: {
          stopId: stop.id,
          distanceFromTargetM: input.distanceFromTargetM,
          requiresReview,
          receiverName: input.receiverName.trim(),
        },
        occurredAt: deliveredAt,
      },
      tx,
    );
  });

  if (pkg.addressId) {
    await db
      .update(knownAddresses)
      .set({
        deliverySuccessCount: sql`${knownAddresses.deliverySuccessCount} + 1`,
        ...(requiresReview ? {} : { verifiedByDriver: true }),
        updatedAt: new Date(),
      })
      .where(and(eq(knownAddresses.id, pkg.addressId), eq(knownAddresses.orgId, orgId)));
  }

  return { deliveryId: delivery.id };
}

/**
 * DELIVERY_FAILED — §9.7. El chofer reporta una falla: se crea el incidente
 * (motivo + foto + comentario), el paquete pasa EN_DOMICILIO → FALLA_REPORTADA
 * y la parada queda FAILED. La RESOLUCIÓN (retry/reprogramar/devolver) la
 * decide Operaciones desde la bandeja (FASE 11) — acá solo se reporta.
 */
export async function reportDeliveryFailed(
  orgId: string,
  driverId: string,
  input: ReportDeliveryFailedInput,
): Promise<{ incidentId: string }> {
  const route = await getDriverRoute(
    orgId,
    driverId,
    DELIVERY_ROUTE_STATUSES,
    input.routeId,
  );
  const { stop, pkg } = await getStopWithPackage(orgId, input.routeId, input.stopId);
  const reportedAt = new Date(input.reportedAt);

  const photoUrl = input.photoUrls?.[0];
  if (!photoUrl) {
    throw Errors.validation("la foto de la incidencia es obligatoria (§9.7)");
  }

  await ensureAtDomicile(driverId, pkg, route.id, stop.id);

  const [incident] = await db
    .insert(incidents)
    .values({
      orgId,
      packageId: pkg.id,
      routeId: route.id,
      driverId,
      reason: input.reason as typeof incidents.$inferSelect.reason,
      description: input.comment?.trim() || null,
      photoUrls: input.photoUrls ?? [],
      lat: input.lat ?? null,
      lng: input.lng ?? null,
    })
    .returning({ id: incidents.id });

  if (!incident) {
    throw Errors.internal("no se pudo crear el incidente");
  }

  await runPackageTransition({
    packageId: pkg.id,
    toStatus: "FALLA_REPORTADA",
    actorId: driverId,
    actorRoles: ["driver"],
    metadata: {
      routeId: route.id,
      stopId: stop.id,
      reason: input.reason,
      photoUrl,
      incidentId: incident.id,
    },
  });

  await db.transaction(async (tx) => {
    await setStopStatus({ stop, toStatus: "FAILED", tx });
    await logDomainEvent(
      {
        orgId,
        entityType: "INCIDENT",
        entityId: incident.id,
        eventType: "DELIVERY_FAILED",
        actorId: driverId,
        actorRole: "driver",
        fromStatus: "EN_DOMICILIO",
        toStatus: "FALLA_REPORTADA",
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        metadata: { stopId: stop.id, reason: input.reason },
        occurredAt: reportedAt,
      },
      tx,
    );
  });

  if (pkg.addressId) {
    await db
      .update(knownAddresses)
      .set({
        deliveryFailCount: sql`${knownAddresses.deliveryFailCount} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(knownAddresses.id, pkg.addressId), eq(knownAddresses.orgId, orgId)));
  }

  return { incidentId: incident.id };
}

/**
 * STOPS_REORDERED — §9.8. Re-secuenciación manual de paradas por el chofer.
 * Valida que la lista nueva contenga exactamente las mismas paradas de la
 * ruta (nada se agrega ni se pierde) y reescribe `sequence` en orden.
 */
export async function reorderStops(
  orgId: string,
  driverId: string,
  input: ReorderStopsInput,
): Promise<void> {
  const route = await getDriverRoute(
    orgId,
    driverId,
    REORDER_ROUTE_STATUSES,
    input.routeId,
  );

  const stops = await db
    .select({ id: routeStops.id, sequence: routeStops.sequence })
    .from(routeStops)
    .where(eq(routeStops.routeId, route.id));

  const currentIds = new Set(stops.map((s) => s.id));
  if (
    input.orderedStopIds.length !== currentIds.size ||
    input.orderedStopIds.some((id) => !currentIds.has(id)) ||
    new Set(input.orderedStopIds).size !== input.orderedStopIds.length
  ) {
    throw Errors.validation("la lista de paradas reordenada no coincide con la ruta");
  }

  const reorderedAt = new Date(input.reorderedAt);
  await db.transaction(async (tx) => {
    for (const [index, stopId] of input.orderedStopIds.entries()) {
      const current = stops.find((s) => s.id === stopId);
      if (!current || current.sequence === index + 1) continue;
      await tx
        .update(routeStops)
        .set({ sequence: index + 1, updatedAt: new Date() })
        .where(eq(routeStops.id, stopId));
    }
    await logDomainEvent(
      {
        orgId,
        entityType: "ROUTE",
        entityId: route.id,
        eventType: "STOPS_REORDERED",
        actorId: driverId,
        actorRole: "driver",
        metadata: { orderedStopIds: input.orderedStopIds },
        occurredAt: reorderedAt,
      },
      tx,
    );
  });
}

/**
 * DELIVERY_PHOTO_ATTACH — §9.6 offline. La foto se sube a Storage cuando
 * hay señal; si la entrega ya se sincronizó sin foto, este attach la suma
 * a `photo_urls` por `deliveryKey`. Idempotente: si el path ya está, no
 * se duplica.
 */
export async function attachDeliveryPhoto(
  orgId: string,
  driverId: string,
  input: AttachDeliveryPhotoInput,
): Promise<void> {
  const route = await getDriverRoute(
    orgId,
    driverId,
    REORDER_ROUTE_STATUSES,
    input.routeId,
  );

  const [delivery] = await db
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.orgId, orgId),
        eq(deliveries.routeId, route.id),
        eq(deliveries.idempotencyKey, input.deliveryKey),
      ),
    );
  if (!delivery) {
    throw Errors.notFound("no hay una entrega sincronizada con esa deliveryKey");
  }
  if (delivery.photoUrls.includes(input.photoUrl)) return;

  await db
    .update(deliveries)
    .set({ photoUrls: [...delivery.photoUrls, input.photoUrl], updatedAt: new Date() })
    .where(eq(deliveries.id, delivery.id));
}

/**
 * ROUTE_FINISHED — §9.9. Cierre del día del chofer: la ruta pasa
 * IN_TRANSIT → COMPLETED y el vehículo vuelve a AVAILABLE. Los paquetes
 * que quedaron EN_REPARTO/EN_DOMICILIO se mantienen en su estado — el
 * cierre administrativo con devoluciones es de Operaciones (bandeja).
 */
export async function finishRoute(
  orgId: string,
  driverId: string,
  input: FinishRouteInput,
): Promise<void> {
  const route = await getDriverRoute(
    orgId,
    driverId,
    DELIVERY_ROUTE_STATUSES,
    input.routeId,
  );
  const finishedAt = new Date(input.finishedAt);

  const [vehicle] = route.vehicleId
    ? await db.select().from(vehicles).where(eq(vehicles.id, route.vehicleId))
    : [];

  await db.transaction(async (tx) => {
    await tx
      .update(routes)
      .set({
        status: "COMPLETED",
        completedAt: finishedAt,
        actualDurationS: route.startedAt
          ? Math.max(
              0,
              Math.round((finishedAt.getTime() - route.startedAt.getTime()) / 1000),
            )
          : null,
        updatedAt: finishedAt,
      })
      .where(eq(routes.id, route.id));

    await logDomainEvent(
      {
        orgId,
        entityType: "ROUTE",
        entityId: route.id,
        eventType: "ROUTE_FINISHED",
        actorId: driverId,
        actorRole: "driver",
        fromStatus: route.status,
        toStatus: "COMPLETED",
        lat: input.finalLat ?? null,
        lng: input.finalLng ?? null,
        metadata: { finishedAt: finishedAt.toISOString() },
        occurredAt: finishedAt,
      },
      tx,
    );

    if (vehicle && vehicle.status === "IN_ROUTE") {
      await setVehicleStatus({
        orgId,
        vehicle,
        toStatus: "AVAILABLE",
        actorId: driverId,
        actorRole: "driver",
        occurredAt: finishedAt,
        tx,
      });
    }
  });
}
