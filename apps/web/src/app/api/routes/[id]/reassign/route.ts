import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseBody,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { reassignPackageRoute } from "@/lib/services/route-planning";

const paramsSchema = z.object({ id: z.string().uuid("id de ruta inválido") });
const bodySchema = z.object({ packageId: z.string().uuid("id de paquete inválido") });

/**
 * POST /api/routes/:id/reassign — ajuste manual (§8, etapa 3: "arrastrar un
 * paquete de una ruta a otra → recalcula en vivo"). `:id` es la ruta
 * DESTINO; el paquete se saca de la ruta en la que esté y ambas rutas
 * quedan re-secuenciadas con la matriz real.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id: toRouteId } = await parseParams(paramsSchema, params);
    const { packageId } = await parseBody(bodySchema, request);

    await consumeRateLimit(`routes:reassign:${ctx.userId}`, {
      limit: 60,
      windowSeconds: 60,
    });

    await reassignPackageRoute(ctx.orgId, packageId, toRouteId);
    return jsonOk({ packageId, routeId: toRouteId });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
