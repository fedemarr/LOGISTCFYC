import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseBody,
  requireRole,
  toAppError,
} from "@/lib/api";
import { finishFullScan } from "@/lib/services/custody";

const bodySchema = z.object({
  routeId: z.string().uuid("id de ruta inválido"),
});

/**
 * POST /api/driver/custody/finish — paso 4 de la custodia (§9.3): cierra el
 * escaneo individual. Sin faltantes/sobrantes el acta pasa a RESOLVED y la
 * custodia se confirma; si quedan, devuelve la lista de faltantes y sobrantes.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["driver"]);
    const body = await parseBody(bodySchema, request);

    await consumeRateLimit(`custody:${ctx.userId}`, { limit: 20, windowSeconds: 60 });

    const result = await finishFullScan(ctx.orgId, ctx.userId, body);
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
