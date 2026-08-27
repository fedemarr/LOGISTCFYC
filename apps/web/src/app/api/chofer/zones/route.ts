import { jsonError, jsonOk, toAppError } from "@/lib/api";
import { requireDriver } from "@/lib/services/driver-qr";
import { listZones } from "@/lib/services/zones";

/**
 * ZONAS PARA EL CHOFER (FYM).
 * GET /api/chofer/zones → zonas activas de la org (para elegir el turno).
 */

export async function GET(request: Request): Promise<Response> {
  try {
    const driver = await requireDriver(request);
    const zones = await listZones(driver.orgId);
    return jsonOk({ zones });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
