import { describe, expect, it } from "vitest";
import { routeQrPayload, parseRouteQrPayload } from "../lib/route-id";

describe("routeQrPayload / parseRouteQrPayload", () => {
  it("el payload generado se parsea de vuelta al mismo routeId", () => {
    const routeId = "b3f1c2a0-1234-4abc-9def-000000000001";
    expect(parseRouteQrPayload(routeQrPayload(routeId))).toBe(routeId);
  });

  it("un código sin el prefijo de ruta devuelve null", () => {
    expect(
      parseRouteQrPayload("FYC-DRIVER-b3f1c2a0-1234-4abc-9def-000000000001"),
    ).toBeNull();
    expect(parseRouteQrPayload("FYC-CONT-001")).toBeNull();
    expect(parseRouteQrPayload("ML-4471801")).toBeNull();
    expect(parseRouteQrPayload("")).toBeNull();
  });

  it("tolera espacios alrededor del código", () => {
    const routeId = "b3f1c2a0-1234-4abc-9def-000000000001";
    expect(parseRouteQrPayload(`  ${routeQrPayload(routeId)}  `)).toBe(routeId);
  });

  it("el prefijo solo, sin id, devuelve null", () => {
    expect(parseRouteQrPayload("FYC-ROUTE-")).toBeNull();
  });
});
