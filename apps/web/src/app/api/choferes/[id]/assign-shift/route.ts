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
import { assignShiftByAdmin } from "@/lib/services/shifts";

/**
 * ASIGNAR TURNO (FYM) — admin/dispatcher/warehouse. Pedido de Fede: "que
 * el admin pueda pre-armar el turno" — el chofer no tiene que declarar
 * zona/paquetes ni subir captura, solo tocar "Iniciar" en la PWA.
 * POST /api/choferes/:id/assign-shift { zoneId | zoneName, packageCount }
 */

const paramsSchema = z.object({ id: z.string().uuid("id inválido") });
const bodySchema = z
  .object({
    zoneId: z.string().uuid().optional(),
    zoneName: z.string().min(2).max(150).optional(),
    packageCount: z.number().int().min(1).max(1_000_000),
  })
  .refine((v) => v.zoneId ?? v.zoneName, {
    message: "hace falta zoneId o zoneName",
    path: ["zoneName"],
  });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id } = await parseParams(paramsSchema, context.params);
    const body = await parseBody(bodySchema, request);

    const shift = await assignShiftByAdmin(
      ctx.orgId,
      id,
      body.zoneName ? { zoneName: body.zoneName } : { zoneId: body.zoneId! },
      body.packageCount,
      actorFrom(ctx),
    );
    return jsonOk({ shift }, undefined, { status: 201 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
