import { z } from "zod";
import {
  actorFrom,
  jsonError,
  jsonOk,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { resolveAlert } from "@/lib/services/alerts";

/**
 * ALERTAS (FYM) — admin/dispatcher.
 * PATCH /api/alerts/:id → resuelve la alerta manualmente.
 */

const paramsSchema = z.object({ id: z.string().uuid("id inválido") });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const { id } = await parseParams(paramsSchema, context.params);
    const alert = await resolveAlert(ctx.orgId, id, actorFrom(ctx));
    return jsonOk(alert);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
