import { and, eq } from "drizzle-orm";
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
import { operations } from "@/lib/db/schema";
import { scanPackage } from "@/lib/services/ingestion";

/**
 * POST /api/operations/:id/scan — escaneo en loop (§9.1 paso 3). Corre la
 * cascada de resolución completa (`scanPackage`) y devuelve el resultado
 * para feedback inmediato en la pantalla de depósito (OK / duplicado /
 * bandeja). "Escanear y resolver direcciones" es admin/dispatcher/
 * warehouse (§3) — el chofer no escanea acá.
 */
const bodySchema = z.object({
  rawCode: z.string().trim().min(1).max(500),
  codeFormat: z
    .enum([
      "QR",
      "CODE_128",
      "CODE_39",
      "PDF417",
      "DATA_MATRIX",
      "EAN_13",
      "OTHER",
      "MANUAL",
    ])
    .optional(),
  clientId: z.string().uuid("cliente inválido").optional(),
  deviceId: z.string().trim().max(200).optional(),
  photoUrl: z.string().url().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
});

const paramsSchema = z.object({ id: z.string().uuid("id de operación inválido") });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id: operationId } = await parseParams(paramsSchema, params);
    const body = await parseBody(bodySchema, request);

    await consumeRateLimit(`operations:scan:${ctx.userId}`, {
      limit: 300,
      windowSeconds: 60,
    });

    const [operation] = await db
      .select({ id: operations.id, status: operations.status })
      .from(operations)
      .where(and(eq(operations.id, operationId), eq(operations.orgId, ctx.orgId)));
    if (!operation) throw Errors.notFound("operación no encontrada");
    if (operation.status !== "OPEN") {
      throw Errors.conflict("la operación ya está cerrada, no se puede escanear");
    }

    const outcome = await scanPackage(ctx, { ...body, operationId });

    return jsonOk(outcome, undefined, { status: 201 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
