import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseBody,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { overrideCustody } from "@/lib/services/custody";

const paramsSchema = z.object({ id: z.string().uuid("id de ruta inválido") });

const bodySchema = z.object({
  reason: z.string().trim().min(1, "el motivo es obligatorio"),
});

/**
 * POST /api/routes/:id/override-custody — §9.3: el dispatcher acepta la
 * diferencia de la custodia (bultos que no cierran) con motivo obligatorio.
 * El acta queda OVERRIDDEN y la ruta puede iniciar. Solo admin/dispatcher.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const { id: routeId } = await parseParams(paramsSchema, params);
    const body = await parseBody(bodySchema, request);

    await consumeRateLimit(`routes:override:${ctx.userId}`, {
      limit: 20,
      windowSeconds: 60,
    });

    const result = await overrideCustody(ctx.orgId, routeId, ctx, body.reason);
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
