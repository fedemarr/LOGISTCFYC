import { z } from "zod";
import {
  consumeRateLimit,
  Errors,
  jsonError,
  jsonOk,
  parseQuery,
  requireRole,
  toAppError,
} from "@/lib/api";
import { getDeliveryMetrics } from "@/lib/services/metrics";

const querySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

function defaultRange(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  from.setUTCHours(0, 0, 0, 0);
  return { from, to };
}

/**
 * GET /api/metrics/delivery?from=&to= — FASE 12: entregas/día, por
 * chofer, tasa de éxito, paquetes/hora, km, tiempo por entrega,
 * incidencias y reintentos en el rango. admin/dispatcher.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const url = new URL(request.url);
    const query = parseQuery(querySchema, url);

    await consumeRateLimit(`metrics:delivery:${ctx.userId}`, {
      limit: 60,
      windowSeconds: 60,
    });

    const range = defaultRange();
    const from = query.from ? new Date(query.from) : range.from;
    const to = query.to ? new Date(query.to) : range.to;
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw Errors.validation("fechas inválidas");
    }
    if (from >= to) {
      throw Errors.validation("'from' debe ser anterior a 'to'");
    }

    const metrics = await getDeliveryMetrics(ctx.orgId, from, to);
    return jsonOk(metrics);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
