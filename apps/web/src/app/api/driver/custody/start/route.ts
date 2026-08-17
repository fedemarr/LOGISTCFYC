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

const bodySchema = z
  .object({
    /** QR de ruta (`FYC-ROUTE-…`, FASE A): abre la custodia sin escanear contenedor. */
    routeId: z.string().uuid("id de ruta inválido").optional(),
    /** QR/código del contenedor (path clásico §9.3): el asignado a la ruta. */
    containerCode: z
      .string()
      .trim()
      .min(1, "el código del contenedor no puede estar vacío")
      .optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .refine(
    (v) => v.routeId !== undefined || v.containerCode !== undefined,
    "escaneá el QR de la ruta o el QR/código del contenedor",
  );

/**
 * POST /api/driver/custody/start — paso 1 de la custodia (§9.3 + FASE A):
 * el chofer escanea el QR de la RUTA (abre el acta sin escanear el
 * contenedor físico) o el QR/código del contenedor asignado a su ruta.
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
