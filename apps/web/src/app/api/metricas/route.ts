import { z } from "zod";
import { jsonError, jsonOk, parseQuery, requireRole, toAppError } from "@/lib/api";
import { dailyMetrics } from "@/lib/services/metrics";

/**
 * MÉTRICAS DIARIAS (FYM) — admin.
 * GET /api/metricas?date=YYYY-MM-DD → resumen por chofer del día.
 */

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida (YYYY-MM-DD)")
    .optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const url = new URL(request.url);
    const query = parseQuery(querySchema, url);

    const date = query.date ?? new Date().toLocaleDateString("en-CA");

    const rows = await dailyMetrics(ctx.orgId, date);
    return jsonOk({ date, rows });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
