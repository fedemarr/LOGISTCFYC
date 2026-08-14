import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  consumeRateLimit,
  Errors,
  jsonError,
  jsonOk,
  parseBody,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { db } from "@/lib/db";
import { operations, packages } from "@/lib/db/schema";
import { generateInternalCode } from "@/lib/services/ingestion";

/**
 * POST /api/operations/:id/import — importador de manifiesto (§2, §9.1
 * paso 2). El mapeo de columnas (arrastrar columna origen → campo
 * destino) es responsabilidad del cliente: acá se recibe el CSV ya
 * parseado a filas con nombres de campo normalizados, no el CSV crudo —
 * mantiene el backend simple y el mapeo visual vive en el panel (FASE 5
 * UI). Cada fila crea un paquete en PENDIENTE_RESOLUCION (con dirección
 * ya cargada si la columna venía mapeada, o vacía si no — la resuelve el
 * escaneo físico o la bandeja de resolución).
 *
 * Idempotente por `trackingCode` dentro de la misma operación: importar
 * el mismo archivo dos veces no duplica filas.
 */
const rowSchema = z.object({
  trackingCode: z.string().trim().min(1).max(100),
  recipientName: z.string().trim().max(200).optional(),
  recipientPhone: z.string().trim().max(50).optional(),
  address: z.string().trim().max(500).optional(),
  weightKg: z.coerce.number().positive().optional(),
  declaredValue: z.coerce.number().nonnegative().optional(),
});

const bodySchema = z.object({
  clientId: z.string().uuid("cliente inválido").optional(),
  rows: z.array(rowSchema).min(1).max(2000),
});

const paramsSchema = z.object({ id: z.string().uuid("id de operación inválido") });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id: operationId } = await parseParams(paramsSchema, params);
    const body = await parseBody(bodySchema, request, { maxBytes: 5_000_000 });

    await consumeRateLimit(`operations:import:${ctx.userId}`, {
      limit: 10,
      windowSeconds: 60,
    });

    const [operation] = await db
      .select({ id: operations.id, status: operations.status })
      .from(operations)
      .where(and(eq(operations.id, operationId), eq(operations.orgId, ctx.orgId)));
    if (!operation) throw Errors.notFound("operación no encontrada");
    if (operation.status !== "OPEN") {
      throw Errors.conflict("la operación ya está cerrada, no se puede importar");
    }

    const trackingCodes = body.rows.map((r) => r.trackingCode);
    const existing = await db
      .select({ trackingCode: packages.trackingCode })
      .from(packages)
      .where(
        and(
          eq(packages.operationId, operationId),
          inArray(packages.trackingCode, trackingCodes),
        ),
      );
    const existingCodes = new Set(existing.map((r) => r.trackingCode));

    const toInsert = body.rows.filter((r) => !existingCodes.has(r.trackingCode));

    if (toInsert.length > 0) {
      await db.insert(packages).values(
        toInsert.map((row) => ({
          orgId: ctx.orgId,
          operationId,
          clientId: body.clientId,
          trackingCode: row.trackingCode,
          internalCode: generateInternalCode(),
          status: "PENDIENTE_RESOLUCION" as const,
          fromManifest: true,
          recipientName: row.recipientName,
          recipientPhone: row.recipientPhone,
          rawAddressText: row.address,
          destinationSource: row.address ? ("MANIFEST" as const) : undefined,
          destinationConfidence: row.address ? ("HIGH" as const) : undefined,
          weightKg: row.weightKg,
          declaredValue: row.declaredValue?.toString(),
        })),
      );
    }

    await db
      .update(operations)
      .set({ expectedCount: existingCodes.size + toInsert.length, updatedAt: new Date() })
      .where(eq(operations.id, operationId));

    return jsonOk(
      { created: toInsert.length, skipped: existingCodes.size, total: body.rows.length },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
