import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseBody,
  requireRole,
  toAppError,
} from "@/lib/api";
import { closeDay } from "@/lib/services/day-close";

const bodySchema = z.object({
  operationId: z.string().uuid("id de operación inválido").optional(),
});

/**
 * POST /api/operations/day-close — FASE 12 §9.9: cierra el día SOLO si la
 * ecuación de reconciliación balancea; si no, responde 422 con el detalle
 * y la operación queda abierta. admin/dispatcher.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const body = await parseBody(bodySchema, request);

    await consumeRateLimit(`operations:day-close:${ctx.userId}`, {
      limit: 20,
      windowSeconds: 60,
    });

    const result = await closeDay(ctx.orgId, body.operationId, {
      userId: ctx.userId,
      roles: ctx.roles,
    });
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
