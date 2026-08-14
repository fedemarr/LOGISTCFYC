import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { getPackageTimeline } from "@/lib/services/timeline";

const paramsSchema = z.object({ id: z.string().uuid("id de paquete inválido") });

/**
 * GET /api/packages/:id/timeline — FASE 12, criterio de aceptación #9:
 * el timeline completo del paquete leído del event log append-only, en
 * orden cronológico. Accesible a todo rol autenticado de la org (cada rol
 * ve lo que su RLS de `events` permita).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, [
      "admin",
      "dispatcher",
      "warehouse",
      "driver",
    ]);
    const { id } = await parseParams(paramsSchema, params);

    await consumeRateLimit(`packages:timeline:${ctx.userId}`, {
      limit: 120,
      windowSeconds: 60,
    });

    const timeline = await getPackageTimeline(ctx.orgId, id);
    return jsonOk(timeline);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
