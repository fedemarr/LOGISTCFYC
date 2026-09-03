import { consumeRateLimit, jsonError, jsonOk, requireRole, toAppError } from "@/lib/api";
import { syncOrders } from "@/lib/services/orders";

/**
 * SINCRONIZAR PEDIDOS (FYM) — staff.
 * POST /api/tiendanube/sync → trae pedidos nuevos/actualizados de Tienda
 * Nube y los upsertea en `store_orders`.
 */

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    await consumeRateLimit(`tiendanube:sync:${ctx.orgId}`, {
      limit: 10,
      windowSeconds: 60,
    });

    const result = await syncOrders(ctx.orgId);
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
