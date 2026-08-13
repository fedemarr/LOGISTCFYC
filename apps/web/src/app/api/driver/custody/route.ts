import { jsonError, jsonOk, requireRole, toAppError } from "@/lib/api";
import { getDriverCustodyState } from "@/lib/services/custody";

/**
 * GET /api/driver/custody — estado de la custodia del chofer para su ruta
 * activa (§9.3). La app lo usa para saber en qué paso está: sin acta
 * (escaneá el contenedor), acta sin conteo, DISCREPANCY, o lista para
 * iniciar la ruta.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["driver"]);
    const result = await getDriverCustodyState(ctx.orgId, ctx.userId);
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
