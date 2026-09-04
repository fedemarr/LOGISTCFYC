import { and, asc, count, desc, eq, isNull, ne, or } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import {
  driverShifts,
  driverLocations,
  shiftReports,
  storeOrders,
  zoneAlerts,
  zones,
  users,
} from "@/lib/db/schema";
import { logDomainEvent } from "@/lib/services/events";
import { verifyPackageScreenshot } from "@/lib/services/package-verification";
import { findOrCreateZoneByName } from "@/lib/services/zones";
import { uploadFlexScreenshot } from "@/lib/storage";
import { REPORT_INTERVAL_HOURS, REPORT_LATE_MINUTES } from "@fym/shared";
import { haversineDistanceMeters } from "@fym/geo";
import type { DriverAuthContext } from "@/lib/services/driver-qr";
import type { ActorContext } from "@/lib/services/zones";

/**
 * TURNOS DEL CHOFER (FYM)
 *
 * Un turno = jornada de un chofer en un día asignada a una zona. El chofer
 * lo arranca con `{ zoneId | zoneName, packageCount, captura de Flex }`
 * (sale del depósito con ese número de paquetes), hace reportes de avance
 * cada 2-3 h y lo cierra con los que entregó de verdad. `zoneName` (pedido
 * de Fede: el chofer ESCRIBE la zona en vez de elegir de una lista)
 * geocodifica y crea/reusa la zona al vuelo — ver `findOrCreateZoneByName`.
 *
 * El turno arranca en `PENDING`: la captura de Flex se analiza con IA
 * (pedido de Fede: "pago x paquete", confirmar que la cantidad declarada
 * es real) y si coincide con confianza pasa solo a `ACTIVE`. Si la IA no
 * está configurada, no está segura, o el número no coincide, se queda
 * `PENDING` para que alguien del depósito lo confirme a mano — ver
 * `confirmShiftManually`/`rejectShift`.
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
    assignedByAdmin: driverShifts.assignedByAdmin,
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

/** PENDING o ACTIVE (cualquier turno "vivo", no cerrado) — lo usa la PWA
 * para saber si mostrar "esperando confirmación" o "turno en curso". */
export async function getCurrentShiftForDriver(driverId: string, orgId: string) {
  const [row] = await db
    .select(shiftCtxSelect)
    .from(driverShifts)
    .innerJoin(zones, eq(zones.id, driverShifts.zoneId))
    .where(
      and(
        eq(driverShifts.driverId, driverId),
        eq(driverShifts.orgId, orgId),
        ne(driverShifts.status, "ENDED"),
        isNull(driverShifts.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function startShift(
  driver: DriverAuthContext,
  input: (
    { zoneId: string; packageCount: number } | { zoneName: string; packageCount: number }
  ) & { flexScreenshotBase64: string; flexScreenshotMimeType: string },
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

  const screenshotPath = await uploadFlexScreenshot(
    driver.orgId,
    driver.userId,
    input.flexScreenshotBase64,
    input.flexScreenshotMimeType,
  );

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const [created] = await db
    .insert(driverShifts)
    .values({
      orgId: driver.orgId,
      driverId: driver.userId,
      zoneId: zone.id,
      shiftDate: today,
      packageCount: input.packageCount,
      status: "PENDING",
      startedAt: now,
      flexScreenshotPath: screenshotPath,
    })
    .returning();
  if (!created) throw Errors.internal("no se pudo crear el turno");

  // La verificación corre DESPUÉS del insert (no bloquea la creación del
  // turno si la IA tarda o falla) pero ANTES de responderle al chofer —
  // así, si coincide, ya arranca ACTIVE en la primera respuesta en vez de
  // mostrar "esperando confirmación" un instante para nada.
  const verification = await verifyPackageScreenshot(
    input.flexScreenshotBase64,
    input.flexScreenshotMimeType,
    input.packageCount,
  ).catch((): Awaited<ReturnType<typeof verifyPackageScreenshot>> => ({
    status: "analyzed",
    matched: false,
    detectedCount: null,
    confidence: "low",
    reasoning: "la IA tiró un error analizando la captura",
  }));

  const aiAnalysis =
    verification.status === "analyzed"
      ? {
          detectedCount: verification.detectedCount,
          confidence: verification.confidence,
          reasoning: verification.reasoning,
        }
      : null;
  const autoConfirm = verification.status === "analyzed" && verification.matched;

  const [shift] = await db
    .update(driverShifts)
    .set(
      autoConfirm
        ? {
            status: "ACTIVE",
            aiConfirmed: true,
            confirmedAt: now,
            aiAnalysis,
            updatedAt: now,
          }
        : { aiAnalysis, updatedAt: now },
    )
    .where(eq(driverShifts.id, created.id))
    .returning();
  if (!shift) throw Errors.internal("no se pudo actualizar el turno");

  await db.transaction(async (tx) => {
    await log(
      {
        orgId: driver.orgId,
        entityType: "SHIFT",
        entityId: shift.id,
        eventType: autoConfirm ? "SHIFT_STARTED" : "SHIFT_PENDING_CONFIRMATION",
        actorId: driver.userId,
        actorRole: "driver",
        toStatus: shift.status,
        occurredAt: now,
        metadata: { zone: zone.name, packageCount: input.packageCount, aiAnalysis },
      },
      tx,
    );
  });

  return shift;
}

/**
 * El admin/despachante PRE-ARMA el turno de un chofer (zona + paquetes)
 * en vez de que lo declare él — pedido de Fede. Sin captura de Flex ni
 * confirmación de IA/depósito: el chofer solo tiene que tocar "Iniciar"
 * (`startAssignedShift`) para pasar a ACTIVE.
 */
export async function assignShiftByAdmin(
  orgId: string,
  driverId: string,
  zoneInput: { zoneId: string } | { zoneName: string },
  packageCount: number,
  actor: ActorContext,
  log = logDomainEvent,
) {
  const current = await getCurrentShiftForDriver(driverId, orgId);
  if (current) throw Errors.conflict("este chofer ya tiene un turno en curso");

  const zone =
    "zoneName" in zoneInput
      ? await findOrCreateZoneByName(orgId, actor, zoneInput.zoneName, log)
      : await (async () => {
          const [z] = await db
            .select()
            .from(zones)
            .where(
              and(
                eq(zones.id, zoneInput.zoneId),
                eq(zones.orgId, orgId),
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
      orgId,
      driverId,
      zoneId: zone.id,
      shiftDate: today,
      packageCount,
      status: "PENDING",
      startedAt: now,
      assignedByAdmin: true,
    })
    .returning();
  if (!shift) throw Errors.internal("no se pudo asignar el turno");

  await db.transaction(async (tx) => {
    await log(
      {
        orgId,
        entityType: "SHIFT",
        entityId: shift.id,
        eventType: "SHIFT_ASSIGNED_BY_ADMIN",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        toStatus: "PENDING",
        occurredAt: now,
        metadata: { zone: zone.name, packageCount },
      },
      tx,
    );
  });

  return shift;
}

/** El chofer toca "Iniciar" sobre un turno que le pre-armó el admin
 * (`assignShiftByAdmin`) — a diferencia de `confirmShiftManually` (lo
 * confirma alguien del depósito), acá lo inicia el propio chofer. Re-
 * establece `startedAt` al momento real en que arranca (puede haber
 * pasado tiempo desde que el admin lo armó). */
export async function startAssignedShift(
  driver: DriverAuthContext,
  log = logDomainEvent,
) {
  const [pending] = await db
    .select()
    .from(driverShifts)
    .where(
      and(
        eq(driverShifts.driverId, driver.userId),
        eq(driverShifts.orgId, driver.orgId),
        eq(driverShifts.status, "PENDING"),
        eq(driverShifts.assignedByAdmin, true),
        isNull(driverShifts.deletedAt),
      ),
    )
    .limit(1);
  if (!pending) throw Errors.notFound("no tenés un turno asignado esperando");

  const now = new Date();
  const [shift] = await db
    .update(driverShifts)
    .set({ status: "ACTIVE", startedAt: now, updatedAt: now })
    .where(eq(driverShifts.id, pending.id))
    .returning();
  if (!shift) throw Errors.internal("no se pudo iniciar el turno");

  await db.transaction(async (tx) => {
    await log(
      {
        orgId: driver.orgId,
        entityType: "SHIFT",
        entityId: shift.id,
        eventType: "SHIFT_STARTED",
        actorId: driver.userId,
        actorRole: "driver",
        fromStatus: "PENDING",
        toStatus: "ACTIVE",
        occurredAt: now,
      },
      tx,
    );
  });

  return shift;
}

/** Alguien del depósito confirma un turno PENDING a mano (la IA no
 * estaba segura, no coincidía, o no está configurada). */
export async function confirmShiftManually(
  orgId: string,
  shiftId: string,
  actor: { actorId: string; actorRole: string },
  log = logDomainEvent,
) {
  const [pending] = await db
    .select()
    .from(driverShifts)
    .where(
      and(
        eq(driverShifts.id, shiftId),
        eq(driverShifts.orgId, orgId),
        eq(driverShifts.status, "PENDING"),
        isNull(driverShifts.deletedAt),
      ),
    );
  if (!pending) throw Errors.notFound("no hay un turno pendiente con ese id");

  const now = new Date();
  const [shift] = await db
    .update(driverShifts)
    .set({
      status: "ACTIVE",
      confirmedBy: actor.actorId,
      confirmedAt: now,
      updatedAt: now,
    })
    .where(eq(driverShifts.id, shiftId))
    .returning();
  if (!shift) throw Errors.internal("no se pudo confirmar el turno");

  await db.transaction(async (tx) => {
    await log(
      {
        orgId,
        entityType: "SHIFT",
        entityId: shiftId,
        eventType: "SHIFT_CONFIRMED",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        fromStatus: "PENDING",
        toStatus: "ACTIVE",
        occurredAt: now,
      },
      tx,
    );
  });

  return shift;
}

/** Alguien del depósito rechaza un turno PENDING (la cantidad declarada
 * no coincide con la captura, o la captura no sirve) — el chofer vuelve
 * a la pantalla de arranque y puede intentar de nuevo. */
export async function rejectShift(
  orgId: string,
  shiftId: string,
  actor: { actorId: string; actorRole: string },
  reason: string | undefined,
  log = logDomainEvent,
) {
  const [pending] = await db
    .select()
    .from(driverShifts)
    .where(
      and(
        eq(driverShifts.id, shiftId),
        eq(driverShifts.orgId, orgId),
        eq(driverShifts.status, "PENDING"),
        isNull(driverShifts.deletedAt),
      ),
    );
  if (!pending) throw Errors.notFound("no hay un turno pendiente con ese id");

  const now = new Date();
  await db
    .update(driverShifts)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(driverShifts.id, shiftId));

  await db.transaction(async (tx) => {
    await log(
      {
        orgId,
        entityType: "SHIFT",
        entityId: shiftId,
        eventType: "SHIFT_REJECTED",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        fromStatus: "PENDING",
        occurredAt: now,
        metadata: { reason: reason ?? null },
      },
      tx,
    );
  });
}

/** Turnos DECLARADOS POR EL CHOFER esperando confirmación del depósito
 * (con datos del chofer y la zona para la lista del panel) — los
 * `assignedByAdmin` quedan afuera, esos no esperan que nadie los
 * confirme, solo que el chofer toque "Iniciar" (`startAssignedShift`). */
export async function listPendingShifts(orgId: string) {
  return db
    .select({
      id: driverShifts.id,
      packageCount: driverShifts.packageCount,
      startedAt: driverShifts.startedAt,
      flexScreenshotPath: driverShifts.flexScreenshotPath,
      aiAnalysis: driverShifts.aiAnalysis,
      driver: { id: users.id, fullName: users.fullName },
      zone: { id: zones.id, name: zones.name },
    })
    .from(driverShifts)
    .innerJoin(users, eq(users.id, driverShifts.driverId))
    .innerJoin(zones, eq(zones.id, driverShifts.zoneId))
    .where(
      and(
        eq(driverShifts.orgId, orgId),
        eq(driverShifts.status, "PENDING"),
        eq(driverShifts.assignedByAdmin, false),
        isNull(driverShifts.deletedAt),
      ),
    )
    .orderBy(asc(driverShifts.startedAt));
}

/**
 * Turnos a los que se le puede asignar un pedido de Tienda Nube
 * (`services/orders.ts`): los ACTIVE (chofer ya en la calle) y los
 * PENDING que armó el admin (`assignShiftByAdmin`) — a esos ya se les
 * puede ir cargando pedidos aunque el chofer todavía no tocó "Iniciar",
 * total el turno ya está confirmado por el admin. Los PENDING que
 * declaró el chofer (esperando IA/depósito) quedan afuera: si se
 * rechazan, dejarían pedidos apuntando a un turno borrado.
 */
/** El turno "vivo" de UN chofer puntual, mismo criterio que
 * `listActiveShiftsForAssignment` — lo usa `assignOrderToDriver` para
 * reusar el turno si ya tiene uno, o decidir que hace falta crear uno. */
export async function getLiveShiftForDriverAssignment(orgId: string, driverId: string) {
  const [row] = await db
    .select({ id: driverShifts.id, status: driverShifts.status })
    .from(driverShifts)
    .where(
      and(
        eq(driverShifts.orgId, orgId),
        eq(driverShifts.driverId, driverId),
        isNull(driverShifts.deletedAt),
        or(
          eq(driverShifts.status, "ACTIVE"),
          and(eq(driverShifts.status, "PENDING"), eq(driverShifts.assignedByAdmin, true)),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listActiveShiftsForAssignment(orgId: string) {
  return db
    .select({
      id: driverShifts.id,
      status: driverShifts.status,
      driver: { id: users.id, fullName: users.fullName },
      zone: { id: zones.id, name: zones.name },
    })
    .from(driverShifts)
    .innerJoin(users, eq(users.id, driverShifts.driverId))
    .innerJoin(zones, eq(zones.id, driverShifts.zoneId))
    .where(
      and(
        eq(driverShifts.orgId, orgId),
        isNull(driverShifts.deletedAt),
        or(
          eq(driverShifts.status, "ACTIVE"),
          and(eq(driverShifts.status, "PENDING"), eq(driverShifts.assignedByAdmin, true)),
        ),
      ),
    )
    .orderBy(asc(users.fullName));
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
  const [shifts, locations, alerts, reportRows, orderCounts] = await Promise.all([
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
    // Pedidos (Tienda Nube/manuales) por turno — "y después cuando un
    // chofer empiece la ruta en la zona se vea los pedidos que tiene en
    // el monitoreo" (pedido de Fede), agrupados por estado para el
    // resumen "X/Y entregados" de cada tarjeta.
    db
      .select({
        shiftId: storeOrders.shiftId,
        status: storeOrders.status,
        cnt: count(),
      })
      .from(storeOrders)
      .where(and(eq(storeOrders.orgId, orgId), isNull(storeOrders.deletedAt)))
      .groupBy(storeOrders.shiftId, storeOrders.status),
  ]);

  if (shifts.length === 0) return [];

  const lastLocationByDriver = new Map<string, (typeof locations)[number]>();
  for (const loc of locations) lastLocationByDriver.set(loc.driverId, loc);

  const openAlertByShift = new Map(alerts.map((a) => [a.shiftId, a]));
  const lastReportByShift = new Map<string, (typeof reportRows)[number]>();
  for (const rep of reportRows) lastReportByShift.set(rep.shiftId, rep);

  const orderCountsByShift = new Map<
    string,
    { total: number; delivered: number; pending: number; failed: number }
  >();
  for (const row of orderCounts) {
    if (!row.shiftId) continue;
    const entry = orderCountsByShift.get(row.shiftId) ?? {
      total: 0,
      delivered: 0,
      pending: 0,
      failed: 0,
    };
    entry.total += row.cnt;
    if (row.status === "DELIVERED") entry.delivered += row.cnt;
    else if (row.status === "FAILED") entry.failed += row.cnt;
    else if (row.status === "ASSIGNED") entry.pending += row.cnt;
    orderCountsByShift.set(row.shiftId, entry);
  }

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
      orders: orderCountsByShift.get(s.shift.id) ?? {
        total: 0,
        delivered: 0,
        pending: 0,
        failed: 0,
      },
    };
  });
}
