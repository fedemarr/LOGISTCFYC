import { describe, expect, it } from "vitest";
import { FINAL_STATUSES, isFinalStatus, PACKAGE_STATUSES, transition } from "../index.js";

describe("state-machine (scaffold FASE 1)", () => {
  it("define los 14 estados del diagrama de §4", () => {
    expect(PACKAGE_STATUSES).toHaveLength(14);
    expect(PACKAGE_STATUSES).toContain("PENDIENTE_RESOLUCION");
    expect(PACKAGE_STATUSES).toContain("ENTREGADO");
  });

  it("marca como finales exactamente ENTREGADO, DEVUELTO, EXTRAVIADO, CANCELADO", () => {
    expect(FINAL_STATUSES).toEqual(["ENTREGADO", "DEVUELTO", "EXTRAVIADO", "CANCELADO"]);
    expect(isFinalStatus("ENTREGADO")).toBe(true);
    expect(isFinalStatus("EN_REPARTO")).toBe(false);
  });

  it("transition() es un placeholder explícito hasta FASE 3", async () => {
    await expect(
      transition({
        packageId: "pkg_1",
        toStatus: "RECIBIDO",
        actorId: "user_1",
        actorRole: "warehouse",
      }),
    ).rejects.toThrow(/FASE 3/);
  });
});
