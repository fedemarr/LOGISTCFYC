import { z } from "zod";
import {
  actorFrom,
  jsonError,
  jsonOk,
  parseBody,
  requireRole,
  toAppError,
} from "@/lib/api";
import { bulkAssignZoneToDriver, bulkAssignZoneToShift } from "@/lib/services/orders";

/**
 * ASIGNAR EN BLOQUE POR ZONA (FYM) — staff.
 * POST /api/orders/assign-zone { zoneId, driverId } → asigna TODOS los
 * pedidos PENDING sugeridos para esa zona al chofer indicado (le arma
 * turno si no tiene uno vivo — ver `bulkAssignZoneToDriver`). También
 * acepta `{ zoneId, shiftId }` para apuntar a un turno puntual.
 */

const bodySchema = z
  .object({
    zoneId: z.string().uuid("id de zona inválido"),
    driverId: z.string().uuid("id de chofer inválido").optional(),
    shiftId: z.string().uuid("id de turno inválido").optional(),
  })
  .refine((v) => v.driverId ?? v.shiftId, {
    message: "hace falta driverId o shiftId",
    path: ["driverId"],
  });

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const body = await parseBody(bodySchema, request);

    const result = body.driverId
      ? await bulkAssignZoneToDriver(
          ctx.orgId,
          body.zoneId,
          body.driverId,
          actorFrom(ctx),
        )
      : await bulkAssignZoneToShift(
          ctx.orgId,
          body.zoneId,
          body.shiftId!,
          actorFrom(ctx),
        );
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
