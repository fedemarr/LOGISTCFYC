import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  consumeRateLimit,
  Errors,
  jsonError,
  jsonOk,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { db } from "@/lib/db";
import { operations } from "@/lib/db/schema";
import { geocodeOperationPackages } from "@/lib/services/geocoding";

const paramsSchema = z.object({ id: z.string().uuid("id de operación inválido") });

/**
 * POST /api/operations/:id/geocode — geocodifica en lote los paquetes
 * RECIBIDO de la operación (§9.1 paso 5). Síncrono por ahora: a 120
 * paquetes/día alcanza (§17, "sobreingeniería que retrasa la salida a
 * producción" — un job en background con cola es una mejora de FASE 12/13
 * si el volumen lo justifica, no un requisito del MVP).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id: operationId } = await parseParams(paramsSchema, params);

    await consumeRateLimit(`operations:geocode:${ctx.userId}`, {
      limit: 10,
      windowSeconds: 60,
    });

    const [operation] = await db
      .select({ id: operations.id })
      .from(operations)
      .where(and(eq(operations.id, operationId), eq(operations.orgId, ctx.orgId)));
    if (!operation) throw Errors.notFound("operación no encontrada");

    const summary = await geocodeOperationPackages(ctx.orgId, operationId, {
      userId: ctx.userId,
      roles: ctx.roles,
    });

    return jsonOk(summary);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
