/**
 * `resolveDestination` (pura) + `scanPackage` (integración contra Supabase
 * real, mismo patrón que `state-machine.test.ts`).
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import { db } from "@/lib/db";
import {
  clients,
  operations,
  organizations,
  packageScans,
  packages,
  userRoles,
  users,
} from "@/lib/db/schema";
import { purgeTestEvents } from "@/lib/db/test-helpers";
import { resolveDestination, scanPackage } from "../ingestion";

describe("resolveDestination (pura)", () => {
  it("resuelve BARCODE_PAYLOAD cuando el código trae la dirección adentro", () => {
    const result = resolveDestination("street=Perú 880|locality=Villa Ballester");
    expect(result.resolved).toBe(true);
    expect(result.source).toBe("BARCODE_PAYLOAD");
    expect(result.confidence).toBe("HIGH");
  });

  it("cae a MANUAL cuando el código no trae nada parseable", () => {
    const result = resolveDestination("ML4471829");
    expect(result.resolved).toBe(false);
    expect(result.source).toBe("MANUAL");
    expect(result.confidence).toBe("LOW");
  });

  it("MANUAL con foto adjunta la deja en rawEvidence para la bandeja", () => {
    const result = resolveDestination("ML4471829", "https://x.test/foto.jpg");
    expect(result.resolved).toBe(false);
    expect(result.rawEvidence?.photoUrl).toBe("https://x.test/foto.jpg");
  });
});

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
const TEST_PASSWORD = "IngTest123!";

describe("scanPackage (integración contra Supabase real)", () => {
  const runId = randomUUID().slice(0, 8);
  let orgId: string;
  let operationId: string;
  let warehouseUserId: string;
  let ctx: AuthContext;
  let clientId: string;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: `Ing Test Org ${runId}` })
      .returning();
    if (!org) throw new Error("no se pudo crear la org de test");
    orgId = org.id;

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: `ing-warehouse-${runId}@test`,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("sin usuario");
    warehouseUserId = data.user.id;

    await db.insert(users).values({
      id: warehouseUserId,
      orgId,
      email: `ing-warehouse-${runId}@test`,
      fullName: "Ing Warehouse",
    });
    await db.insert(userRoles).values({ userId: warehouseUserId, role: "warehouse" });

    const [op] = await db
      .insert(operations)
      .values({ orgId, operationDate: "2026-08-12", status: "OPEN" })
      .returning();
    if (!op) throw new Error("no se pudo crear la operación de test");
    operationId = op.id;

    const [client] = await db
      .insert(clients)
      .values({ orgId, name: `Cliente Test ${runId}`, codePrefix: "ML-" })
      .returning();
    if (!client) throw new Error("no se pudo crear el cliente de test");
    clientId = client.id;

    ctx = {
      userId: warehouseUserId,
      orgId,
      email: `ing-warehouse-${runId}@test`,
      roles: ["warehouse"],
    };
  }, 30_000);

  afterAll(async () => {
    await purgeTestEvents(orgId);

    await db.delete(packageScans).where(sql`org_id = ${orgId}`);
    await db.delete(packages).where(sql`org_id = ${orgId}`);
    await db.delete(operations).where(sql`org_id = ${orgId}`);
    await db.delete(clients).where(sql`org_id = ${orgId}`);
    await db.delete(userRoles).where(sql`user_id = ${warehouseUserId}`);
    await db.delete(users).where(sql`org_id = ${orgId}`);
    await db.delete(organizations).where(sql`id = ${orgId}`);
    await supabaseAdmin.auth.admin.deleteUser(warehouseUserId).catch(() => {});
  }, 30_000);

  it("código con manifiesto pre-cargado (con dirección) resuelve HIGH via MANIFEST", async () => {
    const [manifest] = await db
      .insert(packages)
      .values({
        orgId,
        operationId,
        clientId,
        trackingCode: `MANIFEST-${runId}`,
        internalCode: `ML-MANIFEST-${runId}`,
        status: "PENDIENTE_RESOLUCION",
        rawAddressText: "Perú 880, Villa Ballester",
      })
      .returning();
    if (!manifest) throw new Error("no se pudo crear el paquete manifiesto");

    const outcome = await scanPackage(ctx, {
      rawCode: `MANIFEST-${runId}`,
      operationId,
      clientId,
    });

    expect(outcome.duplicate).toBe(false);
    expect(outcome.resolution.resolved).toBe(true);
    expect(outcome.resolution.source).toBe("MANIFEST");
    expect(outcome.status).toBe("RECIBIDO");
    expect(outcome.packageId).toBe(manifest.id);
  });

  it("código nuevo con payload parseable crea el paquete y resuelve BARCODE_PAYLOAD", async () => {
    const rawCode = `street=Alvear 1502|locality=Villa Ballester|BC-${runId}`;
    const outcome = await scanPackage(ctx, { rawCode, operationId, clientId });

    expect(outcome.resolution.source).toBe("BARCODE_PAYLOAD");
    expect(outcome.status).toBe("RECIBIDO");
    expect(outcome.internalCode).toMatch(/^ML-/);

    const [pkg] = await db
      .select()
      .from(packages)
      .where(sql`id = ${outcome.packageId}::uuid`);
    expect(pkg?.rawAddressText).toContain("Alvear 1502");
  });

  it("código nuevo sin nada parseable cae a la bandeja de resolución (MANUAL, PENDIENTE_RESOLUCION)", async () => {
    const outcome = await scanPackage(ctx, {
      rawCode: `NOPARSE-${runId}`,
      operationId,
      clientId,
    });

    expect(outcome.resolution.resolved).toBe(false);
    expect(outcome.resolution.source).toBe("MANUAL");
    expect(outcome.status).toBe("PENDIENTE_RESOLUCION");
  });

  it("escanear el mismo código dos veces en la misma operación detecta duplicado", async () => {
    const rawCode = `DUP-${runId}`;
    const first = await scanPackage(ctx, { rawCode, operationId, clientId });
    expect(first.duplicate).toBe(false);

    const second = await scanPackage(ctx, { rawCode, operationId, clientId });
    expect(second.duplicate).toBe(true);
    expect(second.packageId).toBe(first.packageId);
    expect(second.duplicateInfo?.scannedBy).toBe(warehouseUserId);

    const scans = await db
      .select()
      .from(packageScans)
      .where(sql`raw_code = ${rawCode}`);
    expect(scans).toHaveLength(2); // ambos intentos quedan auditados, §2
  });

  it("prefijo de cliente que no matchea marca wrongClient", async () => {
    const outcome = await scanPackage(ctx, {
      rawCode: `OTHERPREFIX-${runId}`,
      operationId,
      clientId, // codePrefix registrado es "ML-", este código no arranca así
    });
    expect(outcome.wrongClient).toBe(true);
  });
});
