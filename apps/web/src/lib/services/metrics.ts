import { and, asc, count, eq, gte, isNull, lte, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  deliveryAlerts,
  driverShifts,
  shiftReports,
  users,
  zoneAlerts,
  zones,
} from "@/lib/db/schema";

/**
 * MÉTRICAS DIARIAS (FYM) — panel del admin.
 *
 * Para una fecha dada, por chofer con turno: cantidad de paquetes con la que
 * salió, cuántos entregó (último avance del turno), cuántos quedaron sin
 * repartir, horas trabajadas, cantidad de alertas de geocerca y si las
 * resolvió. Es la vista que Fede pidió en el dashboard: "cuánto lleva cada
 * uno hoy".
 */

export interface DailyMetricsRow {
  driver: { id: string; fullName: string };
  shift: {
    id: string;
    // El tipo de columna real incluye PENDING, aunque la query filtra esos
    // turnos afuera (ver `ne(driverShifts.status, "PENDING")` más abajo).
    status: "PENDING" | "ACTIVE" | "ENDED";
    startedAt: Date;
    endedAt: Date | null;
    packageCount: number;
    undeliveredCount: number | null;
  };
  zoneName: string;
  delivered: number;
  hoursWorkedHours: number;
  alertCountOpen: number;
  alertCountTotal: number;
}

export async function dailyMetrics(
  orgId: string,
  date: string,
): Promise<DailyMetricsRow[]> {
  const [shifts, reports, alerts] = await Promise.all([
    db
      .select({
        shift: {
          id: driverShifts.id,
          status: driverShifts.status,
          startedAt: driverShifts.startedAt,
          endedAt: driverShifts.endedAt,
          packageCount: driverShifts.packageCount,
          undeliveredCount: driverShifts.undeliveredCount,
        },
        zoneName: zones.name,
        driver: { id: users.id, fullName: users.fullName },
      })
      .from(driverShifts)
      .innerJoin(users, eq(users.id, driverShifts.driverId))
      .innerJoin(zones, eq(zones.id, driverShifts.zoneId))
      .where(
        and(
          eq(driverShifts.orgId, orgId),
          eq(driverShifts.shiftDate, date),
          // PENDING (todavía sin confirmar la cantidad declarada, pedido
          // de Fede) no cuenta como actividad real todavía — no debe
          // aparecer en las métricas hasta que se confirme.
          ne(driverShifts.status, "PENDING"),
          isNull(driverShifts.deletedAt),
        ),
      )
      .orderBy(asc(driverShifts.startedAt)),
    db
      .select({
        shiftId: shiftReports.shiftId,
        packagesDone: shiftReports.packagesDone,
      })
      .from(shiftReports)
      .orderBy(asc(shiftReports.reportedAt)),
    db
      .select({
        shiftId: zoneAlerts.shiftId,
        status: zoneAlerts.status,
        cnt: count(),
      })
      .from(zoneAlerts)
      .where(and(eq(zoneAlerts.orgId, orgId), isNull(zoneAlerts.deletedAt)))
      .groupBy(zoneAlerts.shiftId, zoneAlerts.status),
  ]);

  // Último reporte por turno (progreso máx alcanzado).
  const lastDeliveryByShift = new Map<string, number>();
  for (const rep of reports) lastDeliveryByShift.set(rep.shiftId, rep.packagesDone);

  const alertCountByShift = new Map<string, { open: number; total: number }>();
  for (const a of alerts) {
    const entry = alertCountByShift.get(a.shiftId) ?? { open: 0, total: 0 };
    entry.total += a.cnt;
    if (a.status === "OPEN") entry.open += a.cnt;
    alertCountByShift.set(a.shiftId, entry);
  }

  const now = new Date();
  return shifts.map((s) => {
    const shiftsStatus = s.shift.status;
    const end = s.shift.endedAt ?? now;
    const hoursWorkedHours =
      Math.round(((end.getTime() - s.shift.startedAt.getTime()) / 3_600_000) * 10) / 10;
    const alertsEntry = alertCountByShift.get(s.shift.id) ?? { open: 0, total: 0 };

    // Turno cerrado: lo que declaró el chofer AL CERRAR manda — es la
    // cifra contra la que se paga ("pago x paquete", pedido de Fede), más
    // confiable que el último aviso de avance (podría haber quedado
    // desactualizado). Turno todavía activo: el último aviso es lo único
    // que hay.
    const delivered =
      shiftsStatus === "ENDED" && s.shift.undeliveredCount != null
        ? Math.max(0, s.shift.packageCount - s.shift.undeliveredCount)
        : (lastDeliveryByShift.get(s.shift.id) ?? 0);

    return {
      driver: s.driver,
      shift: { ...s.shift, status: shiftsStatus },
      zoneName: s.zoneName,
      delivered,
      hoursWorkedHours,
      alertCountOpen: alertsEntry.open,
      alertCountTotal: alertsEntry.total,
    };
  });
}

/**
 * MÉTRICAS GLOBALES (rango de fechas) — pedido de Fede: "una [sección]
 * global de cuánto performance, tiempo de entrega, etc, es todo
 * estadística". Agrega los turnos de un período a nivel org:
 * - Resumen: paquetes entregados, horas promedio por turno, % de turnos
 *   sin incidentes (sin alerta de geocerca NI de entrega).
 * - Ranking por chofer: entregados, sin repartir, horas, alertas y
 *   entregados por hora (performance).
 */

export interface RangeShiftInput {
  shiftId: string;
  driver: { id: string; fullName: string };
  zoneName: string;
  status: "ACTIVE" | "ENDED";
  startedAt: Date;
  endedAt: Date | null;
  packageCount: number;
  undeliveredCount: number | null;
  lastPackagesDone: number | null;
  geoAlertCount: number;
  deliveryAlertCount: number;
}

export interface RangeDriverRow {
  driver: { id: string; fullName: string };
  shiftsCount: number;
  totalPackages: number;
  delivered: number;
  undelivered: number;
  hoursWorkedHours: number;
  geoAlertCount: number;
  deliveryAlertCount: number;
  deliveredPerHour: number;
}

export interface RangeMetrics {
  from: string;
  to: string;
  summary: {
    totalShifts: number;
    endedShifts: number;
    activeShifts: number;
    totalPackages: number;
    totalDelivered: number;
    totalUndelivered: number;
    avgHoursPerShift: number;
    shiftsWithIncidents: number;
    pctShiftsWithoutIncidents: number;
  };
  drivers: RangeDriverRow[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Agregación PURA (sin DB) para las métricas de rango — se puede testear
 * unitario y es la fuente de verdad de los números que ve el panel.
 */
export function aggregateRangeMetrics(
  raw: RangeShiftInput[],
  ctx: { from: string; to: string; now?: Date },
): RangeMetrics {
  const now = ctx.now ?? new Date();

  const perShift = raw.map((r) => {
    const end = r.endedAt ?? now;
    const hoursWorkedHours = round1((end.getTime() - r.startedAt.getTime()) / 3_600_000);
    // Mismo criterio que dailyMetrics: turno cerrado → lo que declaró al
    // cerrar manda (fuente de verdad del pago); turno activo → último aviso.
    const delivered =
      r.status === "ENDED" && r.undeliveredCount != null
        ? Math.max(0, r.packageCount - r.undeliveredCount)
        : (r.lastPackagesDone ?? 0);
    const undelivered =
      r.status === "ENDED" && r.undeliveredCount != null
        ? r.undeliveredCount
        : Math.max(0, r.packageCount - delivered);
    return { ...r, hoursWorkedHours, delivered, undelivered };
  });

  const totalShifts = perShift.length;
  const endedShifts = perShift.filter((s) => s.status === "ENDED").length;
  const totalPackages = perShift.reduce((acc, s) => acc + s.packageCount, 0);
  const totalDelivered = perShift.reduce((acc, s) => acc + s.delivered, 0);
  const totalUndelivered = perShift.reduce((acc, s) => acc + s.undelivered, 0);
  const sumHours = perShift.reduce((acc, s) => acc + s.hoursWorkedHours, 0);
  const shiftsWithIncidents = perShift.filter(
    (s) => s.geoAlertCount > 0 || s.deliveryAlertCount > 0,
  ).length;

  const byDriver = new Map<
    string,
    {
      id: string;
      fullName: string;
      shiftsCount: number;
      totalPackages: number;
      delivered: number;
      undelivered: number;
      hoursWorkedHours: number;
      geoAlertCount: number;
      deliveryAlertCount: number;
    }
  >();
  for (const s of perShift) {
    const entry = byDriver.get(s.driver.id) ?? {
      id: s.driver.id,
      fullName: s.driver.fullName,
      shiftsCount: 0,
      totalPackages: 0,
      delivered: 0,
      undelivered: 0,
      hoursWorkedHours: 0,
      geoAlertCount: 0,
      deliveryAlertCount: 0,
    };
    entry.shiftsCount += 1;
    entry.totalPackages += s.packageCount;
    entry.delivered += s.delivered;
    entry.undelivered += s.undelivered;
    entry.hoursWorkedHours += s.hoursWorkedHours;
    entry.geoAlertCount += s.geoAlertCount;
    entry.deliveryAlertCount += s.deliveryAlertCount;
    if (s.driver.fullName) entry.fullName = s.driver.fullName;
    byDriver.set(s.driver.id, entry);
  }

  const drivers: RangeDriverRow[] = [...byDriver.values()]
    .map((d) => ({
      driver: { id: d.id, fullName: d.fullName },
      shiftsCount: d.shiftsCount,
      totalPackages: d.totalPackages,
      delivered: d.delivered,
      undelivered: d.undelivered,
      hoursWorkedHours: round1(d.hoursWorkedHours),
      geoAlertCount: d.geoAlertCount,
      deliveryAlertCount: d.deliveryAlertCount,
      deliveredPerHour: round1(
        d.hoursWorkedHours > 0 ? d.delivered / d.hoursWorkedHours : 0,
      ),
    }))
    .sort(
      (a, b) =>
        b.deliveredPerHour - a.deliveredPerHour ||
        b.delivered - a.delivered ||
        a.driver.fullName.localeCompare(b.driver.fullName),
    );

  return {
    from: ctx.from,
    to: ctx.to,
    summary: {
      totalShifts,
      endedShifts,
      activeShifts: totalShifts - endedShifts,
      totalPackages,
      totalDelivered,
      totalUndelivered,
      avgHoursPerShift: totalShifts ? round1(sumHours / totalShifts) : 0,
      shiftsWithIncidents,
      pctShiftsWithoutIncidents: totalShifts
        ? Math.round(((totalShifts - shiftsWithIncidents) / totalShifts) * 100)
        : 100,
    },
    drivers,
  };
}

export async function rangeMetrics(
  orgId: string,
  from: string,
  to: string,
): Promise<RangeMetrics> {
  const [shifts, reports, geoAlerts, deliveryRows] = await Promise.all([
    db
      .select({
        shift: {
          id: driverShifts.id,
          status: driverShifts.status,
          startedAt: driverShifts.startedAt,
          endedAt: driverShifts.endedAt,
          packageCount: driverShifts.packageCount,
          undeliveredCount: driverShifts.undeliveredCount,
        },
        zoneName: zones.name,
        driver: { id: users.id, fullName: users.fullName },
      })
      .from(driverShifts)
      .innerJoin(users, eq(users.id, driverShifts.driverId))
      .innerJoin(zones, eq(zones.id, driverShifts.zoneId))
      .where(
        and(
          eq(driverShifts.orgId, orgId),
          gte(driverShifts.shiftDate, from),
          lte(driverShifts.shiftDate, to),
          ne(driverShifts.status, "PENDING"),
          isNull(driverShifts.deletedAt),
        ),
      )
      .orderBy(asc(users.fullName), asc(driverShifts.startedAt)),
    db
      .select({
        shiftId: shiftReports.shiftId,
        packagesDone: shiftReports.packagesDone,
      })
      .from(shiftReports)
      .orderBy(asc(shiftReports.reportedAt)),
    db
      .select({
        shiftId: zoneAlerts.shiftId,
        cnt: count(),
      })
      .from(zoneAlerts)
      .where(and(eq(zoneAlerts.orgId, orgId), isNull(zoneAlerts.deletedAt)))
      .groupBy(zoneAlerts.shiftId),
    db
      .select({
        shiftId: deliveryAlerts.shiftId,
        cnt: count(),
      })
      .from(deliveryAlerts)
      .where(eq(deliveryAlerts.orgId, orgId))
      .groupBy(deliveryAlerts.shiftId),
  ]);

  const lastDeliveryByShift = new Map<string, number>();
  for (const rep of reports) lastDeliveryByShift.set(rep.shiftId, rep.packagesDone);

  const geoCountByShift = new Map(geoAlerts.map((a) => [a.shiftId, a.cnt]));
  const deliveryCountByShift = new Map(deliveryRows.map((a) => [a.shiftId, a.cnt]));

  const raw: RangeShiftInput[] = shifts.map((s) => ({
    shiftId: s.shift.id,
    driver: s.driver,
    zoneName: s.zoneName,
    // La query excluye PENDING (`ne(driverShifts.status, "PENDING")`) — no
    // hay turnos sin confirmar acá, solo que el tipo de la columna incluye
    // PENDING en general.
    status: s.shift.status as "ACTIVE" | "ENDED",
    startedAt: s.shift.startedAt,
    endedAt: s.shift.endedAt,
    packageCount: s.shift.packageCount,
    undeliveredCount: s.shift.undeliveredCount,
    lastPackagesDone: lastDeliveryByShift.get(s.shift.id) ?? null,
    geoAlertCount: geoCountByShift.get(s.shift.id) ?? 0,
    deliveryAlertCount: deliveryCountByShift.get(s.shift.id) ?? 0,
  }));

  return aggregateRangeMetrics(raw, { from, to });
}
