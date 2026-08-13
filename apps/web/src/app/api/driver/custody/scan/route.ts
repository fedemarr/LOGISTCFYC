import { z } from "zod";
import { CODE_FORMATS } from "@fyc/shared";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseBody,
  requireRole,
  toAppError,
} from "@/lib/api";
import { scanPackageForCustody } from "@/lib/services/custody";

const bodySchema = z.object({
  routeId: z.string().uuid("id de ruta inválido"),
  rawCode: z.string().trim().min(1, "el código escaneado no puede estar vacío"),
  codeFormat: z.enum(CODE_FORMATS).optional(),
  deviceId: z.string().min(1).max(200).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

/**
 * POST /api/driver/custody/scan — paso 3 de la custodia (§9.3): escaneo
 * individual de bultos ante una diferencia de conteo (método FULL_SCAN),
 * con chequeo cruzado contra las demás rutas activas.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["driver"]);
    const body = await parseBody(bodySchema, request);

    await consumeRateLimit(`custody:${ctx.userId}`, { limit: 120, windowSeconds: 60 });

    const result = await scanPackageForCustody(ctx.orgId, ctx.userId, body);
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
