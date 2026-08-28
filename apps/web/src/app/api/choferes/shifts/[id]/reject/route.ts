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
import { rejectShift } from "@/lib/services/shifts";

/**
 * RECHAZAR TURNO (FYM) — admin/dispatcher/warehouse.
 * POST /api/choferes/shifts/:id/reject → la cantidad declarada no
 * coincide con la captura (o la captura no sirve) — se borra el turno
 * PENDING, el chofer vuelve a la pantalla de arranque en la PWA.
 */

const paramsSchema = z.object({ id: z.string().uuid("id inválido") });
const bodySchema = z.object({ reason: z.string().max(500).optional() });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id } = await parseParams(paramsSchema, context.params);
    const body = await parseBody(bodySchema, request);

    await rejectShift(ctx.orgId, id, actorFrom(ctx), body.reason);
    return jsonOk({ rejected: true });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
