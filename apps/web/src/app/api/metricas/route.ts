import { z } from "zod";
import { jsonError, jsonOk, parseQuery, requireRole, toAppError } from "@/lib/api";
import { Errors } from "@/lib/api/errors";
import { dailyMetrics, rangeMetrics } from "@/lib/services/metrics";

/**
 * MÉTRICAS (FYM) — admin.
 * GET /api/metricas?date=YYYY-MM-DD       → resumen por chofer del día.
 * GET /api/metricas?from=&to=             → métricas globales del rango
 *   (entregados, horas promedio, ranking por chofer).
 */

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const DATE_RE = "fecha inválida (YYYY-MM-DD)";

const querySchema = z.object({
  date: z.string().regex(dateRegex, DATE_RE).optional(),
  from: z.string().regex(dateRegex, DATE_RE).optional(),
  to: z.string().regex(dateRegex, DATE_RE).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const url = new URL(request.url);
    const query = parseQuery(querySchema, url);

    // Modo rango: `from`+`to` (sin `date`). Modo diario: el `date`, con
    // default a hoy.
    if (query.from ?? query.to) {
      const from = query.from;
      const to = query.to;
      if (!from || !to) {
        throw Errors.validation("hacen falta from y to para las métricas de rango");
      }
      if (from > to) {
        throw Errors.validation("from no puede ser posterior a to");
      }
      const metrics = await rangeMetrics(ctx.orgId, from, to);
      return jsonOk(metrics);
    }

    const date = query.date ?? new Date().toLocaleDateString("en-CA");
    const rows = await dailyMetrics(ctx.orgId, date);
    return jsonOk({ date, rows });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
