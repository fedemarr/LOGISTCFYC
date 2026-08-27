import { z } from "zod";
import { jsonError, jsonOk, parseQuery, requireRole, toAppError } from "@/lib/api";
import { listAlerts } from "@/lib/services/alerts";

/**
 * ALERTAS (FYM) — admin/dispatcher.
 * GET /api/alerts?status=OPEN|RESOLVED → alertas de geocerca de la org.
 */

const querySchema = z.object({
  status: z.enum(["OPEN", "RESOLVED"]).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const url = new URL(request.url);
    const query = parseQuery(querySchema, url);

    const alerts = await listAlerts(ctx.orgId, query.status);
    return jsonOk({ alerts });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
