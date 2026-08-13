import { consumeRateLimit, jsonError, jsonOk, requireRole, toAppError } from "@/lib/api";
import { getRouteTracking } from "@/lib/services/monitoring";

export const dynamic = "force-dynamic";

/**
 * GET /api/routes/:id/tracking — FASE 11. Historial de ubicaciones de una
 * ruta (polilínea del recorrido del chofer en el mapa del panel). Solo
 * admin/dispatcher.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const { id } = await params;
    await consumeRateLimit(`routes:tracking:${ctx.userId}`, {
      limit: 120,
      windowSeconds: 60,
    });

    const points = await getRouteTracking(ctx.orgId, id);
    return jsonOk({ items: points });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
