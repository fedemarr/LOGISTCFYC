import { z } from "zod";
import {
  actorFrom,
  jsonError,
  jsonOk,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { rotateDriverQr } from "@/lib/services/driver-qr";

/**
 * CHOFERES — QR (FYM) — admin.
 * POST /api/choferes/:id/qr → rota el token QR del chofer y devuelve el
 * token EN CLARO una sola vez (para generar el QR a imprimir).
 */

const paramsSchema = z.object({ id: z.string().uuid("id inválido") });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const { id } = await parseParams(paramsSchema, context.params);

    const { token } = await rotateDriverQr(ctx.orgId, id, actorFrom(ctx));

    return jsonOk({ token });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
