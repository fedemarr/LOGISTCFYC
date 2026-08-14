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
import { getFinancialMetrics } from "@/lib/services/metrics";

const querySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

function defaultRange(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  from.setUTCHours(0, 0, 0, 0);
  return { from, to };
}

/**
 * GET /api/metrics/financial?from=&to= — FASE 12, métricas económicas
 * (rentabilidad por cliente). SOLO admin. El costo por entrega y el
 * margen por ruta quedan en null: requieren la tarifa/estructura de
 * costos que es decisión de negocio pendiente (§20 #6).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin"]);
    const url = new URL(request.url);
    const query = parseQuery(querySchema, url);

    await consumeRateLimit(`metrics:financial:${ctx.userId}`, {
      limit: 30,
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

    const metrics = await getFinancialMetrics(ctx.orgId, from, to);
    return jsonOk(metrics);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
