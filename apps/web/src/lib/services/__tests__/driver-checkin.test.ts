/**
 * `checkInDriver` — control de salida del chofer (pedido de Fede, no del
 * documento madre). Integración contra Supabase real, escenario mínimo:
 * no hace falta ruta/vehículo, solo un usuario con rol driver.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { driverQrPayload } from "@fyc/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { organizations, userRoles, users } from "@/lib/db/schema";
import { purgeTestEvents } from "@/lib/db/test-helpers";
import { checkInDriver } from "../driver-checkin";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env para correr el test`);
  return value;
}

const supabaseAdmin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const TEST_PASSWORD = "CheckinTest123!";

describe("checkInDriver (integración contra Supabase real)", () => {
  const runId = randomUUID().slice(0, 8);
  let orgId: string;
  let driverId: string;
  let warehouseId: string;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: `Checkin Test Org ${runId}` })
      .returning();
    if (!org) throw new Error("no se pudo crear la org");
    orgId = org.id;

    const { data: driver, error: e1 } = await supabaseAdmin.auth.admin.createUser({
      email: `checkin-driver-${runId}@test`,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (e1 || !driver.user) throw e1 ?? new Error("sin usuario chofer");
    driverId = driver.user.id;

    const { data: warehouse, error: e2 } = await supabaseAdmin.auth.admin.createUser({
      email: `checkin-warehouse-${runId}@test`,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (e2 || !warehouse.user) throw e2 ?? new Error("sin usuario depósito");
    warehouseId = warehouse.user.id;

    await db.insert(users).values([
      {
        id: driverId,
        orgId,
        email: `checkin-driver-${runId}@test`,
        fullName: "Chofer Checkin",
      },
      {
        id: warehouseId,
        orgId,
        email: `checkin-warehouse-${runId}@test`,
        fullName: "Depósito Checkin",
      },
    ]);
    await db.insert(userRoles).values([
      { userId: driverId, role: "driver" },
      { userId: warehouseId, role: "warehouse" },
    ]);
  }, 30_000);

  afterAll(async () => {
    await purgeTestEvents(orgId);
    await db.delete(userRoles).where(eq(userRoles.userId, driverId));
    await db.delete(userRoles).where(eq(userRoles.userId, warehouseId));
    await db.delete(users).where(eq(users.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await supabaseAdmin.auth.admin.deleteUser(driverId).catch(() => {});
    await supabaseAdmin.auth.admin.deleteUser(warehouseId).catch(() => {});
  }, 30_000);

  const actor = () => ({ userId: warehouseId, roles: ["warehouse"] as const });

  it("QR válido de un chofer de la misma org registra la salida", async () => {
    const result = await checkInDriver(orgId, driverQrPayload(driverId), actor());
    expect(result.driverId).toBe(driverId);
    expect(result.driverName).toBe("Chofer Checkin");
  });

  it("un código que no tiene forma de QR de chofer rechaza con VALIDATION_ERROR", async () => {
    await expect(checkInDriver(orgId, "FYC-CONT-001", actor())).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("un QR de chofer de otra organización no lo encuentra", async () => {
    await expect(
      checkInDriver(randomUUID(), driverQrPayload(driverId), actor()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("un usuario sin rol driver rechaza con VALIDATION_ERROR", async () => {
    await expect(
      checkInDriver(orgId, driverQrPayload(warehouseId), actor()),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
