import { z } from "zod";
import {
  actorFrom,
  jsonError,
  jsonOk,
  parseBody,
  requireRole,
  toAppError,
} from "@/lib/api";
import { bulkAssignZoneToShift } from "@/lib/services/orders";

/**
 * ASIGNAR EN BLOQUE POR ZONA (FYM) — staff.
 * POST /api/orders/assign-zone { zoneId, shiftId } → asigna TODOS los
 * pedidos PENDING sugeridos para esa zona al turno indicado, en vez de
 * uno por uno.
 */

const bodySchema = z.object({
  zoneId: z.string().uuid("id de zona inválido"),
  shiftId: z.string().uuid("id de turno inválido"),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const body = await parseBody(bodySchema, request);

    const result = await bulkAssignZoneToShift(
      ctx.orgId,
      body.zoneId,
      body.shiftId,
      actorFrom(ctx),
    );
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
