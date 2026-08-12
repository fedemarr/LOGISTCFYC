import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { operations, organizations, packageScans, packages } from "@/lib/db/schema";
import { closeOperation } from "../operations";

describe("closeOperation (integración contra Supabase real)", () => {
  const runId = randomUUID().slice(0, 8);
  let orgId: string;
  let operationId: string;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: `Close Test Org ${runId}` })
      .returning();
    if (!org) throw new Error("no se pudo crear la org de test");
    orgId = org.id;

    const [op] = await db
      .insert(operations)
      .values({ orgId, operationDate: "2026-08-12", status: "OPEN", expectedCount: 2 })
      .returning();
    if (!op) throw new Error("no se pudo crear la operación de test");
    operationId = op.id;

    // Del manifiesto (fromManifest=true): uno se escanea, el otro no (faltante).
    const [scanned] = await db
      .insert(packages)
      .values({
        orgId,
        operationId,
        internalCode: `ML-CLOSE-SCANNED-${runId}`,
        trackingCode: `TC-SCANNED-${runId}`,
        fromManifest: true,
        status: "PENDIENTE_RESOLUCION",
      })
      .returning();
    await db.insert(packages).values({
      orgId,
      operationId,
      internalCode: `ML-CLOSE-MISSING-${runId}`,
      trackingCode: `TC-MISSING-${runId}`,
      fromManifest: true,
      status: "PENDIENTE_RESOLUCION",
    });
    // Sobrante: no vino del manifiesto pero SÍ se escaneó.
    const [surplus] = await db
      .insert(packages)
      .values({
        orgId,
        operationId,
        internalCode: `ML-CLOSE-SURPLUS-${runId}`,
        trackingCode: `TC-SURPLUS-${runId}`,
        fromManifest: false,
        status: "PENDIENTE_RESOLUCION",
      })
      .returning();

    if (!scanned || !surplus)
      throw new Error("no se pudieron crear los paquetes de test");

    await db.insert(packageScans).values([
      {
        packageId: scanned.id,
        orgId,
        rawCode: `TC-SCANNED-${runId}`,
        codeFormat: "OTHER",
        scanContext: "INTAKE",
      },
      {
        packageId: surplus.id,
        orgId,
        rawCode: `TC-SURPLUS-${runId}`,
        codeFormat: "OTHER",
        scanContext: "INTAKE",
      },
    ]);
  }, 30_000);

  afterAll(async () => {
    await db.delete(packageScans).where(sql`org_id = ${orgId}`);
    await db.delete(packages).where(sql`org_id = ${orgId}`);
    await db.delete(operations).where(sql`org_id = ${orgId}`);
    await db.delete(organizations).where(sql`id = ${orgId}`);
  }, 30_000);

  it("reporta faltantes (del manifiesto, sin escanear) y sobrantes (escaneados, sin manifiesto)", async () => {
    const result = await closeOperation(orgId, operationId);

    expect(result.operation.status).toBe("CLOSED");
    expect(result.reconciliation.expected).toBe(2);
    expect(result.reconciliation.received).toBe(2); // scanned + surplus

    expect(result.reconciliation.missing).toHaveLength(1);
    expect(result.reconciliation.missing[0]?.trackingCode).toBe(`TC-MISSING-${runId}`);

    expect(result.reconciliation.surplus).toHaveLength(1);
    expect(result.reconciliation.surplus[0]?.trackingCode).toBe(`TC-SURPLUS-${runId}`);

    const [row] = await db
      .select()
      .from(operations)
      .where(eq(operations.id, operationId));
    expect(row?.status).toBe("CLOSED");
    expect(row?.receivedCount).toBe(2);
  });

  it("cerrar una operación ya cerrada falla con CONFLICT", async () => {
    const err = await closeOperation(orgId, operationId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("CONFLICT");
  });

  it("operación inexistente falla con NOT_FOUND", async () => {
    const err = await closeOperation(orgId, randomUUID()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("NOT_FOUND");
  });
});
