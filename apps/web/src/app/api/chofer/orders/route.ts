import { jsonError, jsonOk, toAppError } from "@/lib/api";
import { requireDriver } from "@/lib/services/driver-qr";
import { getActiveShiftForDriver } from "@/lib/services/shifts";
import { listOrdersForShift } from "@/lib/services/orders";

/**
 * MIS PEDIDOS (FYM) — PWA del chofer.
 * GET /api/chofer/orders → pedidos de Tienda Nube asignados al turno
 * ACTIVO del chofer (apartado de mapa + lista, pedido de Fede) — vacío
 * si no tiene turno activo o no le asignaron nada todavía.
 */

export async function GET(request: Request): Promise<Response> {
  try {
    const driver = await requireDriver(request);
    const active = await getActiveShiftForDriver(driver.userId, driver.orgId);
    if (!active) return jsonOk({ orders: [] });

    const orders = await listOrdersForShift(driver.orgId, active.shift.id);
    return jsonOk({ orders });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
