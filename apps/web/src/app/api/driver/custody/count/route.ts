import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseBody,
  requireRole,
  toAppError,
} from "@/lib/api";
import { submitCustodyCount } from "@/lib/services/custody";

const bodySchema = z.object({
  routeId: z.string().uuid("id de ruta inválido"),
  countedCount: z.number().int("el conteo debe ser un entero").min(0),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

/**
 * POST /api/driver/custody/count — paso 2 de la custodia (§9.3): el chofer
 * carga el conteo real de bultos. Si no coincide con el esperado, el acta
 * queda DISCREPANCY y la ruta NO puede iniciar.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["driver"]);
    const body = await parseBody(bodySchema, request);

    await consumeRateLimit(`custody:${ctx.userId}`, { limit: 20, windowSeconds: 60 });

    const result = await submitCustodyCount(ctx.orgId, ctx.userId, body);
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
