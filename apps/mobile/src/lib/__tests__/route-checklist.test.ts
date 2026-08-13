import { describe, expect, it } from "vitest";
import { evaluateChecklist } from "../route-checklist";

function baseInput() {
  return {
    gpsAccuracyM: 12,
    locationPermissionGranted: true,
    batteryOptimizationDisabled: true,
    routeDownloaded: true,
    batteryLevel: 0.8,
    canStart: true,
  };
}

describe("evaluateChecklist (§9.4)", () => {
  it("con todo OK habilita el inicio", () => {
    const r = evaluateChecklist(baseInput());
    expect(r.canStart).toBe(true);
    expect(r.batteryLow).toBe(false);
    expect(r.items.every((i) => i.ok)).toBe(true);
  });

  it("GPS con precisión >= 50 m bloquea", () => {
    const r = evaluateChecklist({ ...baseInput(), gpsAccuracyM: 51 });
    expect(r.canStart).toBe(false);
    const gps = r.items.find((i) => i.key === "gps");
    expect(gps?.ok).toBe(false);
  });

  it("sin permiso de ubicación bloquea", () => {
    const r = evaluateChecklist({ ...baseInput(), locationPermissionGranted: false });
    expect(r.canStart).toBe(false);
  });

  it("con optimización de batería activa bloquea", () => {
    const r = evaluateChecklist({ ...baseInput(), batteryOptimizationDisabled: false });
    expect(r.canStart).toBe(false);
  });

  it("sin ruta descargada bloquea", () => {
    const r = evaluateChecklist({ ...baseInput(), routeDownloaded: false });
    expect(r.canStart).toBe(false);
  });

  it("sin custodia confirmada bloquea", () => {
    const r = evaluateChecklist({ ...baseInput(), canStart: false });
    expect(r.canStart).toBe(false);
  });

  it("batería <= 20 % advierte pero NO bloquea", () => {
    const r = evaluateChecklist({ ...baseInput(), batteryLevel: 0.18 });
    expect(r.batteryLow).toBe(true);
    expect(r.canStart).toBe(true);
  });

  it("batería desconocida (null) no advierte ni bloquea", () => {
    const r = evaluateChecklist({ ...baseInput(), batteryLevel: null });
    expect(r.batteryLow).toBe(false);
    expect(r.canStart).toBe(true);
  });
});
