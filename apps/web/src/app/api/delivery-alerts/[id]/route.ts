import { z } from "zod";
import {
  actorFrom,
  jsonError,
  jsonOk,
  parseBody,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { updateDeliveryAlert } from "@/lib/services/delivery-alerts";

/**
 * ALERTAS DE ENTREGA (FYM) — admin/dispatcher.
 * PATCH /api/delivery-alerts/:id → marcar la alerta como CONTACTED
 *   ("ya lo llamé") o RESOLVED ("está resuelto").
 */

const paramsSchema = z.object({ id: z.string().uuid("id inválido") });

const bodySchema = z.object({
  status: z.enum(["CONTACTED", "RESOLVED"]),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const { id } = await parseParams(paramsSchema, context.params);
    const body = await parseBody(bodySchema, request);

    const alert = await updateDeliveryAlert(ctx.orgId, id, body.status, actorFrom(ctx));
    return jsonOk(alert);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
