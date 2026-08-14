import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseQuery,
  requireRole,
  toAppError,
} from "@/lib/api";
import { getDayReconciliation } from "@/lib/services/day-close";

const querySchema = z.object({
  operationId: z.string().uuid("id de operación inválido").optional(),
});

/**
 * GET /api/operations/day-reconciliation — FASE 12 §9.9: lee la
 * reconciliación del día (CARGADOS = ENTREGADOS + FALLIDOS + DEVUELTOS +
 * EN_DEPÓSITO) sin cerrar nada. admin/dispatcher.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const url = new URL(request.url);
    const query = parseQuery(querySchema, url);

    await consumeRateLimit(`operations:day-reconciliation:${ctx.userId}`, {
      limit: 60,
      windowSeconds: 60,
    });

    const result = await getDayReconciliation(ctx.orgId, query.operationId);
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
