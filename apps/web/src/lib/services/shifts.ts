import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import {
  driverShifts,
  driverLocations,
  shiftReports,
  zoneAlerts,
  zones,
  users,
} from "@/lib/db/schema";
import { logDomainEvent } from "@/lib/services/events";
import { findOrCreateZoneByName } from "@/lib/services/zones";
import { REPORT_INTERVAL_HOURS, REPORT_LATE_MINUTES } from "@fym/shared";
import { haversineDistanceMeters } from "@fym/geo";
import type { DriverAuthContext } from "@/lib/services/driver-qr";

/**
 * TURNOS DEL CHOFER (FYM)
 *
 * Un turno = jornada de un chofer en un día asignada a una zona. El chofer
 * lo arranca con `{ zoneId | zoneName, packageCount }` (sale del depósito
 * con ese número de paquetes), hace reportes de avance cada 2-3 h y lo
 * cierra con los que quedaron sin repartir. `zoneName` (pedido de Fede: el
 * chofer ESCRIBE la zona en vez de elegir de una lista) geocodifica y
 * crea/reusa la zona al vuelo — ver `findOrCreateZoneByName`.
 */

export type ActiveShiftWithContext = Awaited<ReturnType<typeof getActiveShiftForDriver>>;

const shiftCtxSelect = {
  shift: {
    id: driverShifts.id,
    orgId: driverShifts.orgId,
    driverId: driverShifts.driverId,
    zoneId: driverShifts.zoneId,
    shiftDate: driverShifts.shiftDate,
    packageCount: driverShifts.packageCount,
    status: driverShifts.status,
    startedAt: driverShifts.startedAt,
    endedAt: driverShifts.endedAt,
    undeliveredCount: driverShifts.undeliveredCount,
    notes: driverShifts.notes,
  },
  zone: {
    id: zones.id,
    name: zones.name,
    colorHex: zones.colorHex,
    centerLat: zones.centerLat,
    centerLng: zones.centerLng,
    radiusM: zones.radiusM,
  },
} as const;

export async function getActiveShiftForDriver(driverId: string, orgId: string) {
  const [row] = await db
    .select(shiftCtxSelect)
    .from(driverShifts)
    .innerJoin(zones, eq(zones.id, driverShifts.zoneId))
    .where(
      and(
        eq(driverShifts.driverId, driverId),
        eq(driverShifts.orgId, orgId),
        eq(driverShifts.status, "ACTIVE"),
        isNull(driverShifts.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function startShift(
  driver: DriverAuthContext,
  input:
    { zoneId: string; packageCount: number } | { zoneName: string; packageCount: number },
  log = logDomainEvent,
) {
  const actor = { actorId: driver.userId, actorRole: "driver" };

  const zone =
    "zoneName" in input
      ? await findOrCreateZoneByName(driver.orgId, actor, input.zoneName, log)
      : await (async () => {
          const [z] = await db
            .select()
            .from(zones)
            .where(
              and(
                eq(zones.id, input.zoneId),
                eq(zones.orgId, driver.orgId),
                isNull(zones.deletedAt),
              ),
            )
            .limit(1);
          if (!z) throw Errors.notFound("zona no encontrada");
          return z;
        })();
  if (!zone.isActive) throw Errors.validation("la zona no está activa");

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const [shift] = await db
    .insert(driverShifts)
    .values({
      orgId: driver.orgId,
      driverId: driver.userId,
      zoneId: zone.id,
      shiftDate: today,
      packageCount: input.packageCount,
      status: "ACTIVE",
      startedAt: now,
    })
    .returning();

  if (!shift) throw Errors.internal("no se pudo crear el turno");

  await db.transaction(async (tx) => {
    await log(
      {
        orgId: driver.orgId,
        entityType: "SHIFT",
        entityId: shift.id,
        eventType: "SHIFT_STARTED",
        actorId: driver.userId,
        actorRole: "driver",
        toStatus: "ACTIVE",
        occurredAt: now,
        metadata: { zone: zone.name, packageCount: input.packageCount },
      },
      tx,
    );
  });

  return shift;
}

export async function endShift(
  driver: DriverAuthContext,
  input: { undeliveredCount: number; notes?: string },
  log = logDomainEvent,
) {
  const current = await getActiveShiftForDriver(driver.userId, driver.orgId);
  if (!current) throw Errors.conflict("no hay un turno activo para cerrar");

  const now = new Date();
  const [shift] = await db
    .update(driverShifts)
    .set({
      status: "ENDED",
      endedAt: now,
      undeliveredCount: input.undeliveredCount,
      notes: input.notes ?? null,
    })
    .where(eq(driverShifts.id, current.shift.id))
    .returning();

  if (!shift) throw Errors.internal("no se pudo cerrar el turno");

  await db.transaction(async (tx) => {
    // Cerramos toda alerta de geocerca abierta del turno.
    await tx
      .update(zoneAlerts)
      .set({ status: "RESOLVED", resolvedAt: now })
      .where(and(eq(zoneAlerts.shiftId, shift.id), eq(zoneAlerts.status, "OPEN")));
    await log(
      {
        orgId: driver.orgId,
        entityType: "SHIFT",
        entityId: shift.id,
        eventType: "SHIFT_ENDED",
        actorId: driver.userId,
        actorRole: "driver",
        fromStatus: "ACTIVE",
        toStatus: "ENDED",
        occurredAt: now,
        metadata: { undeliveredCount: input.undeliveredCount },
      },
      tx,
    );
  });

  return shift;
}

export async function reportProgress(
  driver: DriverAuthContext,
  input: { packagesDone: number; note?: string },
  log = logDomainEvent,
) {
  const current = await getActiveShiftForDriver(driver.userId, driver.orgId);
  if (!current) throw Errors.conflict("no hay un turno activo");

  if (input.packagesDone < 0 || input.packagesDone > current.shift.packageCount) {
    throw Errors.validation("packagesDone fuera de rango");
  }

  const now = new Date();
  const [report] = await db
    .insert(shiftReports)
    .values({
      orgId: driver.orgId,
      shiftId: current.shift.id,
      driverId: driver.userId,
      packagesDone: input.packagesDone,
      note: input.note ?? null,
      reportedAt: now,
    })
    .returning();

  await db.transaction(async (tx) => {
    await log(
      {
        orgId: driver.orgId,
        entityType: "SHIFT",
        entityId: current.shift.id,
        eventType: "SHIFT_REPORT",
        actorId: driver.userId,
        actorRole: "driver",
        toStatus: "ACTIVE",
        occurredAt: now,
        metadata: { packagesDone: input.packagesDone },
      },
      tx,
    );
  });

  return report;
}

/** Último reporte de avance del turno (para saber si está vencido). */
export async function getLatestReport(shiftId: string) {
  const [row] = await db
    .select()
    .from(shiftReports)
    .where(eq(shiftReports.shiftId, shiftId))
    .orderBy(desc(shiftReports.reportedAt))
    .limit(1);
  return row ?? null;
}

export function isReportOverdue(lastReportedAt: Date | null, now = new Date()): boolean {
  if (!lastReportedAt) return false;
  const elapsedMinutes = (now.getTime() - lastReportedAt.getTime()) / 60_000;
  return elapsedMinutes > REPORT_LATE_MINUTES;
}

export function nextReportDueAt(startedAt: Date, lastReportedAt: Date | null): Date {
  const base = lastReportedAt ?? startedAt;
  return new Date(base.getTime() + REPORT_INTERVAL_HOURS * 60 * 60 * 1000);
}

/**
 * MOTOR DE GEOCERCA.
 *
 * Recibe una ubicación GPS de un turno activo y decide si cayó fuera del
 * radio de la zona. Open/cerrar alertas LEFT_ZONE: crea una si está afuera
 * (y no hay una abierta para este turno) o la resuelve si volvió adentro.
 */
export async function evaluateGeofence(
  driver: DriverAuthContext,
  shift: NonNullable<Awaited<ReturnType<typeof getActiveShiftForDriver>>>,
  lat: number,
  lng: number,
  log = logDomainEvent,
): Promise<{ outside: boolean; distanceM: number }> {
  const distanceM = haversineDistanceMeters(
    { lat: shift.zone.centerLat, lng: shift.zone.centerLng },
    { lat, lng },
  );
  const outside = distanceM > shift.zone.radiusM;
  const now = new Date();

  const [openAlert] = await db
    .select({ id: zoneAlerts.id })
    .from(zoneAlerts)
    .where(
      and(
        eq(zoneAlerts.shiftId, shift.shift.id),
        eq(zoneAlerts.status, "OPEN"),
        isNull(zoneAlerts.deletedAt),
      ),
    )
    .limit(1);

  await db.transaction(async (tx) => {
    if (outside && !openAlert) {
      await tx.insert(zoneAlerts).values({
        orgId: shift.shift.orgId,
        shiftId: shift.shift.id,
        driverId: driver.userId,
        zoneId: shift.shift.zoneId,
        alertType: "LEFT_ZONE",
        status: "OPEN",
        distanceOutsideM: Math.round(distanceM - shift.zone.radiusM),
        triggeredAt: now,
      });
      await log(
        {
          orgId: shift.shift.orgId,
          entityType: "ALERT",
          entityId: shift.shift.id,
          eventType: "LEFT_ZONE",
          actorId: driver.userId,
          actorRole: "driver",
          fromStatus: "INSIDE_ZONE",
          toStatus: "OUTSIDE_ZONE",
          occurredAt: now,
          lat,
          lng,
          metadata: { distanceOutsideM: Math.round(distanceM - shift.zone.radiusM) },
        },
        tx,
      );
    } else if (!outside && openAlert) {
      await tx
        .update(zoneAlerts)
        .set({ status: "RESOLVED", resolvedAt: now })
        .where(eq(zoneAlerts.id, openAlert.id));
      await log(
        {
          orgId: shift.shift.orgId,
          entityType: "ALERT",
          entityId: shift.shift.id,
          eventType: "RETURNED_TO_ZONE",
          actorId: driver.userId,
          actorRole: "driver",
          fromStatus: "OUTSIDE_ZONE",
          toStatus: "INSIDE_ZONE",
          occurredAt: now,
          lat,
          lng,
        },
        tx,
      );
    }
  });

  return { outside, distanceM };
}

/** Graba la ubicación GPS y dispara el motor de geocerca si hay turno activo. */
export async function recordLocation(
  driver: DriverAuthContext,
  input: {
    lat: number;
    lng: number;
    accuracyM?: number;
    speedMps?: number;
    heading?: number;
    batteryLevel?: number;
    isMoving?: boolean;
    recordedAt?: string;
  },
  log = logDomainEvent,
) {
  const active = await getActiveShiftForDriver(driver.userId, driver.orgId);

  const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
  if (Number.isNaN(recordedAt.getTime())) {
    throw Errors.validation("recordedAt inválido");
  }

  const [location] = await db
    .insert(driverLocations)
    .values({
      orgId: driver.orgId,
      driverId: driver.userId,
      shiftId: active?.shift.id ?? null,
      lat: input.lat,
      lng: input.lng,
      accuracyM: input.accuracyM ?? null,
      speedMps: input.speedMps ?? null,
      heading: input.heading ?? null,
      batteryLevel: input.batteryLevel ?? null,
      isMoving: input.isMoving ?? null,
      recordedAt,
    })
    .returning();

  let geofence: { outside: boolean; distanceM: number } | null = null;
  if (active) {
    geofence = await evaluateGeofence(driver, active, input.lat, input.lng, log);
  }

  return { location, geofence };
}

/**
 * MONITOREO LIVE (panel del admin).
 * Devuelve por cada chofer con turno activo: última ubicación, zona,
 * minutos desde el último GPS, si está afuera de la geocerca y si el último
 * reporte de avance quedó vencido.
 */
export async function monitoringLive(orgId: string) {
  const [shifts, locations, alerts, reportRows] = await Promise.all([
    db
      .select({
        shift: {
          id: driverShifts.id,
          driverId: driverShifts.driverId,
          zoneId: driverShifts.zoneId,
          packageCount: driverShifts.packageCount,
          startedAt: driverShifts.startedAt,
        },
        zone: {
          id: zones.id,
          name: zones.name,
          colorHex: zones.colorHex,
          centerLat: zones.centerLat,
          centerLng: zones.centerLng,
          radiusM: zones.radiusM,
        },
        driver: { id: users.id, fullName: users.fullName, phone: users.phone },
      })
      .from(driverShifts)
      .innerJoin(zones, eq(zones.id, driverShifts.zoneId))
      .innerJoin(users, eq(users.id, driverShifts.driverId))
      .where(
        and(
          eq(driverShifts.orgId, orgId),
          eq(driverShifts.status, "ACTIVE"),
          isNull(driverShifts.deletedAt),
        ),
      ),
    db
      .select({
        driverId: driverLocations.driverId,
        lat: driverLocations.lat,
        lng: driverLocations.lng,
        accuracyM: driverLocations.accuracyM,
        recordedAt: driverLocations.recordedAt,
      })
      .from(driverLocations)
      .where(eq(driverLocations.orgId, orgId))
      .orderBy(asc(driverLocations.recordedAt)),
    db
      .select({
        id: zoneAlerts.id,
        shiftId: zoneAlerts.shiftId,
        status: zoneAlerts.status,
        triggeredAt: zoneAlerts.triggeredAt,
      })
      .from(zoneAlerts)
      .where(
        and(
          eq(zoneAlerts.orgId, orgId),
          eq(zoneAlerts.status, "OPEN"),
          isNull(zoneAlerts.deletedAt),
        ),
      ),
    db
      .select({
        shiftId: shiftReports.shiftId,
        packagesDone: shiftReports.packagesDone,
        reportedAt: shiftReports.reportedAt,
      })
      .from(shiftReports)
      .orderBy(asc(shiftReports.reportedAt)),
  ]);

  if (shifts.length === 0) return [];

  const lastLocationByDriver = new Map<string, (typeof locations)[number]>();
  for (const loc of locations) lastLocationByDriver.set(loc.driverId, loc);

  const openAlertByShift = new Map(alerts.map((a) => [a.shiftId, a]));
  const lastReportByShift = new Map<string, (typeof reportRows)[number]>();
  for (const rep of reportRows) lastReportByShift.set(rep.shiftId, rep);

  const now = new Date();

  return shifts.map((s) => {
    const lastLoc = lastLocationByDriver.get(s.shift.driverId);
    const openAlert = openAlertByShift.get(s.shift.id);
    const lastReport = lastReportByShift.get(s.shift.id);

    let distanceFromCenterM: number | null = null;
    let outside = false;
    if (lastLoc) {
      distanceFromCenterM = haversineDistanceMeters(
        { lat: s.zone.centerLat, lng: s.zone.centerLng },
        { lat: lastLoc.lat, lng: lastLoc.lng },
      );
      outside = distanceFromCenterM > s.zone.radiusM;
    }

    const gpsAgeMinutes = lastLoc
      ? (now.getTime() - lastLoc.recordedAt.getTime()) / 60_000
      : null;

    return {
      shift: {
        id: s.shift.id,
        packageCount: s.shift.packageCount,
        startedAt: s.shift.startedAt,
      },
      driver: s.driver,
      zone: s.zone,
      lastLocation: lastLoc ?? null,
      gpsAgeMinutes,
      outside,
      distanceFromCenterM,
      openAlert,
      lastReport,
      reportOverdue: lastReport ? isReportOverdue(lastReport.reportedAt, now) : false,
    };
  });
}
