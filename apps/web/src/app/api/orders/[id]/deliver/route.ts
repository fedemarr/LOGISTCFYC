import { z } from "zod";
import {
  actorFrom,
  jsonError,
  jsonOk,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { markOrderDelivered } from "@/lib/services/orders";

/**
 * MARCAR ENTREGADO (FYM) — staff.
 * POST /api/orders/:id/deliver → marca el pedido entregado acá Y empuja
 * el estado a Tienda Nube (fulfillment-order → DELIVERED). Si el push
 * falla, el pedido queda igual marcado acá — `pushedToTiendaNube: false`
 * + `pushError` avisan que hay que revisarlo del otro lado a mano.
 */

const paramsSchema = z.object({ id: z.string().uuid("id inválido") });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id } = await parseParams(paramsSchema, context.params);

    const result = await markOrderDelivered(ctx.orgId, id, actorFrom(ctx));
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
