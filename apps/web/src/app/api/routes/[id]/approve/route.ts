import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { approveRoute } from "@/lib/services/route-planning";

const paramsSchema = z.object({ id: z.string().uuid("id de ruta inválido") });

/**
 * POST /api/routes/:id/approve — APROBAR (§8/§9.2): congela `bulk_number`
 * y transiciona los paquetes a ASIGNADO. Solo admin/dispatcher — es la
 * decisión que habilita imprimir etiquetas, más restrictiva que generar o
 * ajustar la propuesta (inferido, ver docs/DECISIONES.md).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const { id: routeId } = await parseParams(paramsSchema, params);

    await consumeRateLimit(`routes:approve:${ctx.userId}`, {
      limit: 20,
      windowSeconds: 60,
    });

    const result = await approveRoute(ctx.orgId, routeId, {
      userId: ctx.userId,
      roles: ctx.roles,
    });
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
