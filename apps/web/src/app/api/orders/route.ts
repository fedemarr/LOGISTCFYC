import { z } from "zod";
import { jsonError, jsonOk, parseQuery, requireRole, toAppError } from "@/lib/api";
import { listOrders } from "@/lib/services/orders";

/**
 * PEDIDOS DE TIENDA NUBE (FYM) — staff.
 * GET /api/orders?status=PENDING|ASSIGNED|DELIVERED|FAILED|CANCELLED&shiftId=…
 * `shiftId` filtra a los pedidos de un turno puntual — lo usa /monitoreo
 * para mostrar los pedidos de un chofer en curso.
 */

const querySchema = z.object({
  status: z.enum(["PENDING", "ASSIGNED", "DELIVERED", "FAILED", "CANCELLED"]).optional(),
  shiftId: z.string().uuid().optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const url = new URL(request.url);
    const query = parseQuery(querySchema, url);

    const orders = await listOrders(ctx.orgId, query.status, query.shiftId);
    return jsonOk({ orders });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
