/**
 * Unit test del agregador de métricas de rango (sin DB — la agregación es
 * pura: `aggregateRangeMetrics` recibe las filas raw y devuelve el resumen).
 * Cubre: entregados por turno cerrado vs activo (criterio de pago), horas
 * promedio, % de turnos sin incidentes y ranking de choferes.
 */
import { describe, expect, it } from "vitest";
import { aggregateRangeMetrics, type RangeShiftInput } from "../metrics";

const startedAt = (h: number) => new Date(Date.UTC(2026, 0, 20, h, 0, 0));

function shift(partial: Partial<RangeShiftInput> & { shiftId: string }): RangeShiftInput {
  return {
    driver: { id: "d-a", fullName: "Chofer A" },
    zoneName: "Zona Norte",
    status: "ENDED",
    startedAt: startedAt(8),
    endedAt: startedAt(16),
    packageCount: 30,
    undeliveredCount: 8,
    lastPackagesDone: null,
    geoAlertCount: 0,
    deliveryAlertCount: 0,
    ...partial,
  };
}

describe("aggregateRangeMetrics", () => {
  const now = new Date(Date.UTC(2026, 0, 20, 12, 0, 0));

  const raw: RangeShiftInput[] = [
    shift({
      shiftId: "s1",
      driver: { id: "d-a", fullName: "Chofer A" },
      packageCount: 30,
      undeliveredCount: 8,
      startedAt: startedAt(8),
      endedAt: startedAt(16),
      geoAlertCount: 2,
    }),
    shift({
      shiftId: "s2",
      driver: { id: "d-a", fullName: "Chofer A" },
      packageCount: 20,
      undeliveredCount: 5,
      startedAt: startedAt(8),
      endedAt: startedAt(14),
      deliveryAlertCount: 1,
    }),
    shift({
      shiftId: "s3",
      driver: { id: "d-b", fullName: "Chofer B" },
      status: "ACTIVE",
      packageCount: 10,
      undeliveredCount: null,
      lastPackagesDone: 4,
      startedAt: startedAt(9),
      endedAt: null,
      geoAlertCount: 0,
    }),
  ];

  const result = aggregateRangeMetrics(raw, {
    from: "2026-01-01",
    to: "2026-01-31",
    now,
  });

  it("usa el criterio de pago para los turnos cerrados (packageCount - undelivered)", () => {
    expect(result.summary.totalDelivered).toBe(22 + 15 + 4);
    expect(result.summary.totalUndelivered).toBe(13 + 6);
  });

  it("agrega el resumen del período", () => {
    expect(result.summary.totalShifts).toBe(3);
    expect(result.summary.endedShifts).toBe(2);
    expect(result.summary.activeShifts).toBe(1);
    expect(result.summary.totalPackages).toBe(60);
    expect(result.summary.avgHoursPerShift).toBe(5.7); // (8 + 6 + 3) / 3
  });

  it("cuenta turnos con incidentes (geocerca o entrega) como incidentados", () => {
    expect(result.summary.shiftsWithIncidents).toBe(2);
    expect(result.summary.pctShiftsWithoutIncidents).toBe(33); // 1 de 3
  });

  it("agrupa por chofer y rankea por entregados por hora", () => {
    expect(result.drivers).toHaveLength(2);
    const a = result.drivers[0]!;
    const b = result.drivers[1]!;
    expect(a.driver.fullName).toBe("Chofer A");
    expect(a.shiftsCount).toBe(2);
    expect(a.delivered).toBe(37);
    expect(a.undelivered).toBe(13);
    expect(a.hoursWorkedHours).toBe(14);
    expect(a.deliveredPerHour).toBe(2.6); // 37 / 14 → redondeado a 1 decimal
    expect(b.delivered).toBe(4);
    expect(b.undelivered).toBe(6);
    expect(b.deliveredPerHour).toBe(1.3); // 4 / 3
  });

  it("sin turnos devuelve resumen vacío", () => {
    const empty = aggregateRangeMetrics([], { from: "2026-01-01", to: "2026-01-31" });
    expect(empty.summary.totalShifts).toBe(0);
    expect(empty.summary.pctShiftsWithoutIncidents).toBe(100);
    expect(empty.drivers).toEqual([]);
  });
});
