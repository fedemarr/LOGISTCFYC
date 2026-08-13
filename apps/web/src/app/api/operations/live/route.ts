import { consumeRateLimit, jsonError, jsonOk, requireRole, toAppError } from "@/lib/api";
import { getLiveFleet } from "@/lib/services/monitoring";

/**
 * GET /api/operations/live — FASE 11, mapa en vivo del panel (polling
 * 20-30s). Choferes con ruta IN_TRANSIT, última ubicación y alertas
 * computadas (silencio GPS, detenido, atrasado). Solo admin/dispatcher.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    await consumeRateLimit(`operations:live:${ctx.userId}`, {
      limit: 120,
      windowSeconds: 60,
    });

    const items = await getLiveFleet(ctx.orgId);
    return jsonOk({ items });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
