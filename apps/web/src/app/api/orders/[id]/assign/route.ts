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
import { assignOrderToShift } from "@/lib/services/orders";

/**
 * ASIGNAR PEDIDO (FYM) — staff.
 * POST /api/orders/:id/assign { shiftId } → linkea el pedido a un turno
 * de chofer.
 */

const paramsSchema = z.object({ id: z.string().uuid("id inválido") });
const bodySchema = z.object({ shiftId: z.string().uuid("id de turno inválido") });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id } = await parseParams(paramsSchema, context.params);
    const body = await parseBody(bodySchema, request);

    const order = await assignOrderToShift(ctx.orgId, id, body.shiftId, actorFrom(ctx));
    return jsonOk({ order });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
