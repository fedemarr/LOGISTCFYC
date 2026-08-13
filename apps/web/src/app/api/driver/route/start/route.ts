import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseBody,
  requireRole,
  toAppError,
} from "@/lib/api";
import { startRoute } from "@/lib/services/custody";

const bodySchema = z.object({
  routeId: z.string().uuid("id de ruta inválido"),
  gpsAccuracyM: z.number().min(0),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  batteryLevel: z.number().min(0).max(1).optional(),
  batteryOptimizationDisabled: z.boolean(),
  locationPermissionGranted: z.boolean(),
  routeDownloaded: z.boolean(),
});

/**
 * POST /api/driver/route/start — INICIAR RUTA (§9.4). Valida el checklist
 * completo en el servidor (custodia confirmada, vehículo AVAILABLE, GPS
 * < 50m, permisos, optimización de batería off, ruta descargada) y
 * transiciona ASSIGNED → IN_TRANSIT + paquetes → EN_REPARTO.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["driver"]);
    const body = await parseBody(bodySchema, request);

    await consumeRateLimit(`route:start:${ctx.userId}`, { limit: 10, windowSeconds: 60 });

    const result = await startRoute(ctx.orgId, ctx.userId, body);
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
