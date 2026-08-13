import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseBody,
  requireRole,
  toAppError,
} from "@/lib/api";
import { startCustody } from "@/lib/services/custody";

const bodySchema = z.object({
  containerCode: z
    .string()
    .trim()
    .min(1, "el código del contenedor no puede estar vacío"),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

/**
 * POST /api/driver/custody/start — paso 1 de la custodia (§9.3): el chofer
 * escanea el QR/código del contenedor asignado a su ruta y se abre el acta.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["driver"]);
    const body = await parseBody(bodySchema, request);

    await consumeRateLimit(`custody:${ctx.userId}`, { limit: 20, windowSeconds: 60 });

    const result = await startCustody(ctx.orgId, ctx.userId, body);
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
