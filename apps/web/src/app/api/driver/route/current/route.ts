import { jsonError, jsonOk, requireRole, toAppError } from "@/lib/api";
import { getDriverCurrentRoute } from "@/lib/services/driver";

/**
 * GET /api/driver/route/current — "descarga completa de la ruta a local"
 * (§14 FASE 7). Ver `lib/services/driver.ts` para la lógica.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["driver"]);
    const result = await getDriverCurrentRoute(ctx.orgId, ctx.userId);
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
