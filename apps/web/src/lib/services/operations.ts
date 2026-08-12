import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { operations, packageScans, packages } from "@/lib/db/schema";

export interface ReconciliationItem {
  trackingCode: string | null;
  internalCode: string;
}

export interface CloseOperationResult {
  operation: typeof operations.$inferSelect;
  reconciliation: {
    expected: number;
    received: number;
    missing: ReconciliationItem[];
    surplus: ReconciliationItem[];
  };
}

/**
 * Cierre de la recepción (§9.1): "Manifiesto dice 120, se escanearon 117 →
 * reporte de faltantes. Se escanearon 122 → reporte de sobrantes." Ver
 * comentario largo en el Route Handler que la llama
 * (`app/api/operations/[id]/close/route.ts`) para la definición exacta de
 * faltante/sobrante.
 */
export async function closeOperation(
  orgId: string,
  operationId: string,
): Promise<CloseOperationResult> {
  const [operation] = await db
    .select()
    .from(operations)
    .where(and(eq(operations.id, operationId), eq(operations.orgId, orgId)));
  if (!operation) throw Errors.notFound("operación no encontrada");
  if (operation.status === "CLOSED") {
    throw Errors.conflict("la operación ya está cerrada");
  }

  const allPackages = await db
    .select({
      id: packages.id,
      trackingCode: packages.trackingCode,
      internalCode: packages.internalCode,
      fromManifest: packages.fromManifest,
    })
    .from(packages)
    .where(
      and(
        eq(packages.orgId, orgId),
        eq(packages.operationId, operationId),
        isNull(packages.deletedAt),
      ),
    );

  const scannedPackageIds = new Set(
    (
      await db
        .selectDistinct({ packageId: packageScans.packageId })
        .from(packageScans)
        .where(and(eq(packageScans.orgId, orgId), isNotNull(packageScans.packageId)))
    )
      .map((r) => r.packageId)
      .filter((id): id is string => id !== null),
  );

  const missing = allPackages.filter(
    (p) => p.fromManifest && !scannedPackageIds.has(p.id),
  );
  const surplus = allPackages.filter(
    (p) => !p.fromManifest && scannedPackageIds.has(p.id),
  );
  const receivedCount = allPackages.filter((p) => scannedPackageIds.has(p.id)).length;

  const [updated] = await db
    .update(operations)
    .set({ status: "CLOSED", receivedCount, updatedAt: new Date() })
    .where(eq(operations.id, operationId))
    .returning();
  if (!updated) throw Errors.internal("no se pudo cerrar la operación");

  return {
    operation: updated,
    reconciliation: {
      expected: operation.expectedCount,
      received: receivedCount,
      missing: missing.map((p) => ({
        trackingCode: p.trackingCode,
        internalCode: p.internalCode,
      })),
      surplus: surplus.map((p) => ({
        trackingCode: p.trackingCode,
        internalCode: p.internalCode,
      })),
    },
  };
}
