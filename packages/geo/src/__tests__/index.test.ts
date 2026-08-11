import { describe, expect, it } from "vitest";
import { clusterPackages, haversineDistanceMeters, sequenceRoute } from "../index.js";

describe("haversineDistanceMeters", () => {
  it("da 0 para el mismo punto", () => {
    const p = { lat: -34.6037, lng: -58.3816 };
    expect(haversineDistanceMeters(p, p)).toBe(0);
  });

  it("aproxima la distancia Obelisco → La Tablada (~15-16 km)", () => {
    const obelisco = { lat: -34.6037, lng: -58.3816 };
    const laTablada = { lat: -34.6837, lng: -58.5619 };
    const d = haversineDistanceMeters(obelisco, laTablada);
    expect(d).toBeGreaterThan(14_000);
    expect(d).toBeLessThan(20_000);
  });
});

describe("clustering y secuenciación (scaffold FASE 1)", () => {
  it("clusterPackages() es un placeholder explícito hasta FASE 6", () => {
    expect(() => clusterPackages()).toThrow(/FASE 6/);
  });

  it("sequenceRoute() es un placeholder explícito hasta FASE 6", () => {
    expect(() => sequenceRoute()).toThrow(/FASE 6/);
  });
});
