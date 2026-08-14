import { consumeRateLimit, jsonError, jsonOk, requireRole, toAppError } from "@/lib/api";
import { getOperationsDashboard } from "@/lib/services/metrics";

/**
 * GET /api/operations/dashboard — FASE 12, dashboard operativo: paquetes
 * por estado, rutas activas/completadas hoy, choferes en ruta, entregas y
 * fallas del día. Accesible a todo rol autenticado de la org.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, [
      "admin",
      "dispatcher",
      "warehouse",
      "driver",
    ]);
    await consumeRateLimit(`operations:dashboard:${ctx.userId}`, {
      limit: 60,
      windowSeconds: 60,
    });

    const dashboard = await getOperationsDashboard(ctx.orgId);
    return jsonOk(dashboard);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
