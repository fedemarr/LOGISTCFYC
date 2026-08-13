/**
 * MONITOREO EN VIVO Y BANDEJA DEL DISPATCHER — PROMPT-MAESTRO §10 (FASE 11).
 *
 * Todo es de LECTURA y se computa on-read (sin jobs): el panel hace polling
 * cada 20-30s contra `/api/operations/live` y la bandeja contra
 * `/api/operations/inbox`. Los umbrales vienen de env (ver .env):
 *   - `GPS_SILENCE_ALERT_MINUTES` (15): sin ping del chofer en N min.
 *   - `INCIDENT_SLA_SECONDS` (600): incidente abierto más de N seg.
 *   - `MAX_DELIVERY_DISTANCE_M` (150): entrega registrada a más de N m del
 *     domicilio (anti-fraude §9.5) — la bandeja la marca "a revisar".
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import {
  custodyTransfers,
  deliveries,
  driverLocations,
  incidents,
  packages,
  routes,
  users,
  vehicles,
} from "@/lib/db/schema";

const GPS_SILENCE_ALERT_MINUTES = Number(process.env.GPS_SILENCE_ALERT_MINUTES ?? 15);
const INCIDENT_SLA_SECONDS = Number(process.env.INCIDENT_SLA_SECONDS ?? 600);
const MAX_DELIVERY_DISTANCE_M = Number(process.env.MAX_DELIVERY_DISTANCE_M ?? 150);

/** Aviso computado para el dispatcher sobre un chofer/ruta en vivo. */
export interface LiveAlert {
  type: "GPS_SILENCE" | "STOPPED" | "BEHIND_SCHEDULE";
  message: string;
  sinceMin: number;
}

export interface LiveRouteItem {
  routeId: string;
  routeNumber: number;
  startedAt: string | null;
  driverId: string;
  driverName: string;
  plate: string | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  isMoving: boolean | null;
  speedMps: number | null;
  batteryLevel: number | null;
  /** Minutos desde el último ping recibido. */
  lastPingMinAgo: number | null;
  receivedAt: string | null;
  alerts: LiveAlert[];
}

const STOPPED_WINDOW_MIN = 10;
const BEHIND_SCHEDULE_FACTOR = 1.3;

/**
 * GET /api/operations/live — choferes con ruta IN_TRANSIT + su última
 * ubicación + alertas computadas. La "última ubicación" se saca con
 * DISTINCT ON (driver_id) sobre `driver_locations` (una query, sin N+1).
 */
export async function getLiveFleet(orgId: string): Promise<LiveRouteItem[]> {
  const routesActive = await db
    .select({
      routeId: routes.id,
      routeNumber: routes.routeNumber,
      status: routes.status,
      startedAt: routes.startedAt,
      plannedDurationS: routes.plannedDurationS,
      plannedDistanceM: routes.plannedDistanceM,
      driverId: users.id,
      driverName: users.fullName,
      plate: vehicles.plate,
    })
    .from(routes)
    .innerJoin(users, eq(routes.assignedDriverId, users.id))
    .leftJoin(vehicles, eq(routes.vehicleId, vehicles.id))
    .where(
      and(
        eq(routes.orgId, orgId),
        inArray(routes.status, ["IN_TRANSIT"]),
        isNull(routes.deletedAt),
      ),
    );

  if (routesActive.length === 0) return [];

  const routeIds = routesActive.map((r) => r.routeId);
  const lastLocations = await db
    .selectDistinctOn([driverLocations.driverId], {
      driverId: driverLocations.driverId,
      routeId: driverLocations.routeId,
      lat: driverLocations.lat,
      lng: driverLocations.lng,
      accuracyM: driverLocations.accuracyM,
      isMoving: driverLocations.isMoving,
      speedMps: driverLocations.speedMps,
      batteryLevel: driverLocations.batteryLevel,
      receivedAt: driverLocations.receivedAt,
    })
    .from(driverLocations)
    .where(
      and(eq(driverLocations.orgId, orgId), inArray(driverLocations.routeId, routeIds)),
    )
    .orderBy(driverLocations.driverId, desc(driverLocations.receivedAt));

  const now = new Date();

  return routesActive.map((route) => {
    const loc = lastLocations.find((l) => l.driverId === route.driverId);
    const alerts: LiveAlert[] = [];

    if (loc?.receivedAt) {
      const lastPingMinAgo = Math.max(
        0,
        Math.round((now.getTime() - loc.receivedAt.getTime()) / 60000),
      );
      if (lastPingMinAgo > GPS_SILENCE_ALERT_MINUTES) {
        alerts.push({
          type: "GPS_SILENCE",
          message: `sin señal GPS hace ${lastPingMinAgo} min`,
          sinceMin: lastPingMinAgo,
        });
      } else if (loc.isMoving === false && lastPingMinAgo >= STOPPED_WINDOW_MIN) {
        alerts.push({
          type: "STOPPED",
          message: `detenido hace al menos ${lastPingMinAgo} min`,
          sinceMin: lastPingMinAgo,
        });
      }
    } else {
      alerts.push({
        type: "GPS_SILENCE",
        message: "sin ninguna ubicación registrada",
        sinceMin: 0,
      });
    }

    if (route.startedAt && route.plannedDurationS) {
      const elapsedS = (now.getTime() - route.startedAt.getTime()) / 1000;
      const budgetS = route.plannedDurationS * BEHIND_SCHEDULE_FACTOR;
      if (elapsedS > budgetS) {
        const behindMin = Math.round((elapsedS - budgetS) / 60);
        alerts.push({
          type: "BEHIND_SCHEDULE",
          message: `atrasada ${behindMin} min sobre lo planificado`,
          sinceMin: behindMin,
        });
      }
    }

    return {
      routeId: route.routeId,
      routeNumber: route.routeNumber,
      startedAt: route.startedAt?.toISOString() ?? null,
      driverId: route.driverId,
      driverName: route.driverName,
      plate: route.plate,
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      accuracyM: loc?.accuracyM ?? null,
      isMoving: loc?.isMoving ?? null,
      speedMps: loc?.speedMps ?? null,
      batteryLevel: loc?.batteryLevel ?? null,
      lastPingMinAgo:
        loc?.receivedAt != null
          ? Math.max(0, Math.round((now.getTime() - loc.receivedAt.getTime()) / 60000))
          : null,
      receivedAt: loc?.receivedAt?.toISOString() ?? null,
      alerts,
    };
  });
}

export interface TrackingPoint {
  id: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedMps: number | null;
  batteryLevel: number | null;
  isMoving: boolean | null;
  recordedAt: string;
  receivedAt: string;
}

/**
 * GET /api/routes/:id/tracking — historial de ubicaciones de una ruta
 * (para dibujar la polilínea del recorrido, acotado a las últimas 2.000
 * filas y sin paginar — el panel solo pide el día).
 */
export async function getRouteTracking(
  orgId: string,
  routeId: string,
): Promise<TrackingPoint[]> {
  const [route] = await db
    .select({ id: routes.id })
    .from(routes)
    .where(
      and(eq(routes.id, routeId), eq(routes.orgId, orgId), isNull(routes.deletedAt)),
    );
  if (!route) {
    throw Errors.notFound("la ruta no existe o no pertenece a tu organización");
  }

  const rows = await db
    .select({
      id: driverLocations.id,
      lat: driverLocations.lat,
      lng: driverLocations.lng,
      accuracyM: driverLocations.accuracyM,
      speedMps: driverLocations.speedMps,
      batteryLevel: driverLocations.batteryLevel,
      isMoving: driverLocations.isMoving,
      recordedAt: driverLocations.recordedAt,
      receivedAt: driverLocations.receivedAt,
    })
    .from(driverLocations)
    .where(and(eq(driverLocations.routeId, routeId), eq(driverLocations.orgId, orgId)))
    .orderBy(desc(driverLocations.recordedAt))
    .limit(2000);

  return rows.map((r) => ({
    id: r.id,
    lat: r.lat,
    lng: r.lng,
    accuracyM: r.accuracyM,
    speedMps: r.speedMps,
    batteryLevel: r.batteryLevel,
    isMoving: r.isMoving,
    recordedAt: r.recordedAt.toISOString(),
    receivedAt: r.receivedAt.toISOString(),
  }));
}

export interface InboxIncident {
  incidentId: string;
  reason: string;
  description: string | null;
  photoUrls: string[];
  lat: number | null;
  lng: number | null;
  createdAt: string;
  slaOverdueS: number | null;
  packageId: string | null;
  internalCode: string | null;
  routeId: string | null;
  routeNumber: number | null;
  driverName: string | null;
}

export interface InboxReviewDelivery {
  deliveryId: string;
  packageId: string | null;
  internalCode: string | null;
  receiverName: string | null;
  distanceFromTargetM: number | null;
  lat: number | null;
  lng: number | null;
  deliveredAt: string;
  driverName: string | null;
  routeNumber: number | null;
}

export interface InboxCustodyDiscrepancy {
  custodyId: string;
  routeId: string;
  routeNumber: number | null;
  expectedCount: number;
  countedCount: number | null;
  method: string;
  discrepancyNotes: string | null;
  createdAt: string;
  driverName: string | null;
}

export interface DispatchInbox {
  incidents: InboxIncident[];
  reviewDeliveries: InboxReviewDelivery[];
  custodyDiscrepancies: InboxCustodyDiscrepancy[];
}

/**
 * GET /api/operations/inbox — bandeja de excepciones del dispatcher
 * (pantalla principal de FASE 11): incidentes abiertos (con SLA vencido
 * marcado), entregas que requieren revisión (>150 m) y actas de custodia
 * en diferencia sin resolver.
 */
export async function getDispatchInbox(orgId: string): Promise<DispatchInbox> {
  const now = new Date();
  const slaThreshold = new Date(now.getTime() - INCIDENT_SLA_SECONDS * 1000);

  const [incidentRows, reviewRows, custodyRows] = await Promise.all([
    db
      .select({
        incidentId: incidents.id,
        reason: incidents.reason,
        description: incidents.description,
        photoUrls: incidents.photoUrls,
        lat: incidents.lat,
        lng: incidents.lng,
        createdAt: incidents.createdAt,
        packageId: incidents.packageId,
        internalCode: packages.internalCode,
        routeId: incidents.routeId,
        routeNumber: routes.routeNumber,
        driverName: users.fullName,
      })
      .from(incidents)
      .leftJoin(routes, eq(routes.id, incidents.routeId))
      .leftJoin(users, eq(users.id, incidents.driverId))
      .leftJoin(packages, eq(packages.id, incidents.packageId))
      .where(
        and(
          eq(incidents.orgId, orgId),
          inArray(incidents.status, ["OPEN", "ASSIGNED"]),
          isNull(incidents.resolvedAt),
        ),
      )
      .orderBy(desc(incidents.createdAt)),

    db
      .select({
        deliveryId: deliveries.id,
        packageId: deliveries.packageId,
        internalCode: packages.internalCode,
        receiverName: deliveries.receiverName,
        distanceFromTargetM: deliveries.distanceFromTargetM,
        lat: deliveries.lat,
        lng: deliveries.lng,
        deliveredAt: deliveries.deliveredAt,
        driverName: users.fullName,
        routeNumber: routes.routeNumber,
      })
      .from(deliveries)
      .leftJoin(routes, eq(routes.id, deliveries.routeId))
      .leftJoin(users, eq(users.id, deliveries.driverId))
      .leftJoin(packages, eq(packages.id, deliveries.packageId))
      .where(
        and(
          eq(deliveries.orgId, orgId),
          sql`${deliveries.distanceFromTargetM} > ${MAX_DELIVERY_DISTANCE_M}`,
        ),
      )
      .orderBy(desc(deliveries.deliveredAt)),

    db
      .select({
        custodyId: custodyTransfers.id,
        routeId: custodyTransfers.routeId,
        routeNumber: routes.routeNumber,
        expectedCount: custodyTransfers.expectedCount,
        countedCount: custodyTransfers.countedCount,
        method: custodyTransfers.method,
        discrepancyNotes: custodyTransfers.discrepancyNotes,
        createdAt: custodyTransfers.createdAt,
        driverName: users.fullName,
      })
      .from(custodyTransfers)
      .leftJoin(routes, eq(routes.id, custodyTransfers.routeId))
      .leftJoin(users, eq(users.id, custodyTransfers.toUserId))
      .where(
        and(
          eq(custodyTransfers.orgId, orgId),
          eq(custodyTransfers.status, "DISCREPANCY"),
          isNull(custodyTransfers.resolvedAt),
        ),
      )
      .orderBy(desc(custodyTransfers.createdAt)),
  ]);

  return {
    incidents: incidentRows.map((r) => ({
      ...r,
      slaOverdueS:
        r.createdAt < slaThreshold
          ? Math.round((now.getTime() - r.createdAt.getTime()) / 1000)
          : null,
      createdAt: r.createdAt.toISOString(),
    })),
    reviewDeliveries: reviewRows.map((r) => ({
      ...r,
      deliveredAt: r.deliveredAt.toISOString(),
    })),
    custodyDiscrepancies: custodyRows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
