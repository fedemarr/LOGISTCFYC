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
import { resolveIncident } from "@/lib/services/incidents";

const paramsSchema = z.object({ id: z.string().uuid("id de incidencia inválido") });

const bodySchema = z.object({
  resolution: z.enum(["RETRY_NOW", "RESCHEDULE", "RETURN", "DELIVER_ANYWAY", "CANCEL"]),
  note: z.string().max(2000).optional(),
  cancelReason: z.string().max(500).optional(),
});

/**
 * POST /api/incidents/:id/resolve — FASE 12, §9.7. La decisión de
 * Operaciones sobre una incidencia de la calle: RETRY_NOW / RESCHEDULE /
 * RETURN / DELIVER_ANYWAY / CANCEL. Solo admin/dispatcher. La resolución
 * se sincroniza a la app del chofer vía la descarga de la ruta
 * (GET /api/driver/route/current): si es RETRY_NOW, la parada vuelve a la
 * secuencia como PENDING; en el resto de los casos el paquete cambia de
 * estado y la parada queda fuera de la secuencia activa.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const { id: incidentId } = await parseParams(paramsSchema, params);
    const body = await parseBody(bodySchema, request);

    await consumeRateLimit(`incidents:resolve:${ctx.userId}`, {
      limit: 30,
      windowSeconds: 60,
    });

    const result = await resolveIncident(ctx.orgId, incidentId, body, {
      userId: ctx.userId,
      roles: ctx.roles,
    });
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
