import { describe, expect, it } from "vitest";
import { hasRole, isRole, ROLE_LABELS, ROLES } from "../constants/roles.js";

describe("roles", () => {
  it("define exactamente los 4 roles del sistema", () => {
    expect(ROLES).toEqual(["admin", "dispatcher", "warehouse", "driver"]);
  });

  it("tiene un label visible para cada rol", () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it("hasRole detecta roles múltiples por usuario", () => {
    const userRoles = ["admin", "dispatcher", "warehouse"] as const;
    expect(hasRole(userRoles, "warehouse")).toBe(true);
    expect(hasRole(userRoles, "driver")).toBe(false);
  });

  it("isRole valida strings arbitrarios de forma segura", () => {
    expect(isRole("driver")).toBe(true);
    expect(isRole("owner")).toBe(false);
  });
});
