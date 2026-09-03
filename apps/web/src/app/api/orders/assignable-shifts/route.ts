import { jsonError, jsonOk, requireRole, toAppError } from "@/lib/api";
import { listActiveShiftsForAssignment } from "@/lib/services/shifts";

/**
 * TURNOS PARA ASIGNAR (FYM) — staff.
 * GET /api/orders/assignable-shifts → turnos ACTIVE de la org, para el
 * selector de "asignar este pedido a" en /pedidos.
 */

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const shifts = await listActiveShiftsForAssignment(ctx.orgId);
    return jsonOk({ shifts });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
