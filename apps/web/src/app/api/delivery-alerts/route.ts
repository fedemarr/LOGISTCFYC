import { z } from "zod";
import { jsonError, jsonOk, parseQuery, requireRole, toAppError } from "@/lib/api";
import { listDeliveryAlerts } from "@/lib/services/delivery-alerts";

/**
 * ALERTAS DE ENTREGA (FYM) — admin/dispatcher.
 * GET /api/delivery-alerts?status=OPEN|CONTACTED|RESOLVED → cola de
 *   problemas de entrega reportados por los choferes, con el teléfono de
 *   contacto para llamar al destinatario.
 */

const querySchema = z.object({
  status: z.enum(["OPEN", "CONTACTED", "RESOLVED"]).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const url = new URL(request.url);
    const query = parseQuery(querySchema, url);

    const alerts = await listDeliveryAlerts(ctx.orgId, query.status);
    return jsonOk({ alerts });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
