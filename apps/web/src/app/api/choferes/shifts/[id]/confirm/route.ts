import { z } from "zod";
import {
  actorFrom,
  jsonError,
  jsonOk,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { confirmShiftManually } from "@/lib/services/shifts";

/**
 * CONFIRMAR TURNO (FYM) — admin/dispatcher/warehouse.
 * POST /api/choferes/shifts/:id/confirm → cuando la IA no confirmó sola
 * (no coincidía, no estaba segura, o no está configurada), alguien del
 * depósito revisa la captura a mano y confirma que la cantidad
 * declarada es real. El turno pasa a ACTIVE.
 */

const paramsSchema = z.object({ id: z.string().uuid("id inválido") });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id } = await parseParams(paramsSchema, context.params);

    const shift = await confirmShiftManually(ctx.orgId, id, actorFrom(ctx));
    return jsonOk({ shift });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
