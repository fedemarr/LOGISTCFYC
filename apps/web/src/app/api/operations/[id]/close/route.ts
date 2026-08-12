import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { closeOperation } from "@/lib/services/operations";

const paramsSchema = z.object({ id: z.string().uuid("id de operación inválido") });

/**
 * POST /api/operations/:id/close — cierre de la recepción, ver
 * `closeOperation()` en `lib/services/operations.ts` para la lógica y la
 * definición exacta de faltante/sobrante (§9.1).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const { id: operationId } = await parseParams(paramsSchema, params);

    await consumeRateLimit(`operations:close:${ctx.userId}`, {
      limit: 10,
      windowSeconds: 60,
    });

    const result = await closeOperation(ctx.orgId, operationId);
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
