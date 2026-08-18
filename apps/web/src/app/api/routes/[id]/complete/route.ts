import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { completeRouteManually } from "@/lib/services/route-planning";

const paramsSchema = z.object({ id: z.string().uuid("id de ruta inválido") });

/**
 * POST /api/routes/:id/complete — finalizar ruta desde el panel (pedido
 * de Fede): mismo efecto que finishRoute() del chofer pero gatillado por
 * el dispatcher (para cuando el celular se quedó sin batería, la app no
 * sincronizó, etc.). Solo IN_TRANSIT -> COMPLETED.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const { id: routeId } = await parseParams(paramsSchema, params);

    await consumeRateLimit(`routes:complete:${ctx.userId}`, {
      limit: 20,
      windowSeconds: 60,
    });

    await completeRouteManually(ctx.orgId, routeId, {
      userId: ctx.userId,
      roles: ctx.roles,
    });
    return jsonOk({ completed: true });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
