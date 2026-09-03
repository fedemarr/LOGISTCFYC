import { z } from "zod";
import {
  actorFrom,
  jsonError,
  jsonOk,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { markOrderFailed } from "@/lib/services/orders";

/**
 * MARCAR ENTREGA FALLIDA (FYM) — staff.
 * POST /api/orders/:id/fail → el pedido no se pudo entregar (Tienda Nube
 * no tiene un estado equivalente en el fulfillment-order, así que esto
 * queda solo de nuestro lado).
 */

const paramsSchema = z.object({ id: z.string().uuid("id inválido") });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id } = await parseParams(paramsSchema, context.params);

    const order = await markOrderFailed(ctx.orgId, id, actorFrom(ctx));
    return jsonOk({ order });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
