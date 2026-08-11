import { describe, expect, it } from "vitest";
import { FINAL_STATUSES, isFinalStatus, PACKAGE_STATUSES } from "../statuses";

describe("statuses", () => {
  it("define los 14 estados del diagrama de §4", () => {
    expect(PACKAGE_STATUSES).toHaveLength(14);
  });

  it("isFinalStatus reconoce los 4 estados finales", () => {
    for (const status of FINAL_STATUSES) {
      expect(isFinalStatus(status)).toBe(true);
    }
  });

  it("isFinalStatus devuelve false para estados no finales", () => {
    expect(isFinalStatus("EN_REPARTO")).toBe(false);
    expect(isFinalStatus("PENDIENTE_RESOLUCION")).toBe(false);
  });
});
