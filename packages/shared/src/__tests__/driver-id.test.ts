import { describe, expect, it } from "vitest";
import { driverQrPayload, parseDriverQrPayload } from "../lib/driver-id";

describe("driverQrPayload / parseDriverQrPayload", () => {
  it("el payload generado se parsea de vuelta al mismo userId", () => {
    const userId = "b3f1c2a0-1234-4abc-9def-000000000001";
    expect(parseDriverQrPayload(driverQrPayload(userId))).toBe(userId);
  });

  it("un código sin el prefijo de chofer devuelve null", () => {
    expect(parseDriverQrPayload("FYC-CONT-001")).toBeNull();
    expect(parseDriverQrPayload("ML-4471801")).toBeNull();
    expect(parseDriverQrPayload("")).toBeNull();
  });

  it("tolera espacios alrededor del código", () => {
    const userId = "b3f1c2a0-1234-4abc-9def-000000000001";
    expect(parseDriverQrPayload(`  ${driverQrPayload(userId)}  `)).toBe(userId);
  });

  it("el prefijo solo, sin id, devuelve null", () => {
    expect(parseDriverQrPayload("FYC-DRIVER-")).toBeNull();
  });
});
