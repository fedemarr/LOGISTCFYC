import { and, asc, count, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { driverShifts, shiftReports, users, zoneAlerts, zones } from "@/lib/db/schema";

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
    status: "ACTIVE" | "ENDED";
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

    return {
      driver: s.driver,
      shift: { ...s.shift, status: shiftsStatus },
      zoneName: s.zoneName,
      delivered: lastDeliveryByShift.get(s.shift.id) ?? 0,
      hoursWorkedHours,
      alertCountOpen: alertsEntry.open,
      alertCountTotal: alertsEntry.total,
    };
  });
}
