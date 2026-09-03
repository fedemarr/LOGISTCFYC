import { z } from "zod";
import {
  actorFrom,
  jsonError,
  jsonOk,
  parseBody,
  requireRole,
  toAppError,
} from "@/lib/api";
import { createManualOrder } from "@/lib/services/orders";

/**
 * PEDIDO MANUAL (FYM) — staff. Pedido de Fede: "que se puedan cargar
 * pedidos para hacer pruebas manualmente, que esté la opción Tienda Nube
 * y la opción manual". Mismo flujo de acá en más que uno sincronizado
 * (asignar, mapa, entregar) — ver `createManualOrder`.
 * POST /api/orders/manual { orderNumber?, customerName?, customerPhone?,
 *                            shippingAddress?, shippingCity?, shippingProvince? }
 */

const bodySchema = z.object({
  orderNumber: z.string().trim().max(100).optional(),
  customerName: z.string().trim().max(200).optional(),
  customerPhone: z.string().trim().max(50).optional(),
  shippingAddress: z.string().trim().max(300).optional(),
  shippingCity: z.string().trim().max(120).optional(),
  shippingProvince: z.string().trim().max(120).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const body = await parseBody(bodySchema, request);
    const order = await createManualOrder(ctx.orgId, body, actorFrom(ctx));
    return jsonOk({ order });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
