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
import { assignOrderToDriver, assignOrderToShift } from "@/lib/services/orders";

/**
 * ASIGNAR PEDIDO (FYM) — staff.
 * POST /api/orders/:id/assign { driverId } → asigna el pedido al chofer;
 * si no tiene turno vivo, se le arma uno solo (ver `assignOrderToDriver`
 * — pedido de Fede: "sigue sin aparecer los choferes para asignar").
 * También acepta `{ shiftId }` (compatibilidad con `/pedidos/assign-zone`
 * y llamados directos a un turno puntual).
 */

const paramsSchema = z.object({ id: z.string().uuid("id inválido") });
const bodySchema = z
  .object({
    driverId: z.string().uuid("id de chofer inválido").optional(),
    shiftId: z.string().uuid("id de turno inválido").optional(),
  })
  .refine((v) => v.driverId ?? v.shiftId, {
    message: "hace falta driverId o shiftId",
    path: ["driverId"],
  });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id } = await parseParams(paramsSchema, context.params);
    const body = await parseBody(bodySchema, request);

    const order = body.driverId
      ? await assignOrderToDriver(ctx.orgId, id, body.driverId, actorFrom(ctx))
      : await assignOrderToShift(ctx.orgId, id, body.shiftId!, actorFrom(ctx));
    return jsonOk({ order });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
