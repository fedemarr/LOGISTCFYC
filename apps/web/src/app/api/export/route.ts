import { z } from "zod";
import {
  consumeRateLimit,
  Errors,
  jsonError,
  parseQuery,
  requireRole,
  toAppError,
} from "@/lib/api";
import {
  exportDeliveriesCsv,
  exportIncidentsCsv,
  exportOperationsCsv,
  exportPackagesCsv,
} from "@/lib/services/export";

const querySchema = z.object({
  type: z.enum(["packages", "deliveries", "incidents", "operations"]),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  operationId: z.string().uuid("id de operación inválido").optional(),
});

/**
 * GET /api/export?type=...&from=&to= — FASE 12 §7: exporta CSV (con BOM
 * para Excel) de paquetes, entregas, incidencias u operaciones. El CSV se
 * devuelve como descarga (no envelope JSON — es un archivo).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const url = new URL(request.url);
    const query = parseQuery(querySchema, url);

    await consumeRateLimit(`export:${ctx.userId}`, { limit: 30, windowSeconds: 60 });

    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from >= to) {
      throw Errors.validation("'from' debe ser anterior a 'to'");
    }
    if (query.type === "deliveries" || query.type === "incidents") {
      if (!from || !to) {
        throw Errors.validation("exportar entregas/incidencias requiere from y to");
      }
    }

    let result: { content: string; filename: string };
    switch (query.type) {
      case "packages":
        result = await exportPackagesCsv(ctx.orgId, {
          operationId: query.operationId,
        });
        break;
      case "deliveries":
        result = await exportDeliveriesCsv(ctx.orgId, from!, to!);
        break;
      case "incidents":
        result = await exportIncidentsCsv(ctx.orgId, from!, to!);
        break;
      case "operations":
        result = await exportOperationsCsv(ctx.orgId);
        break;
    }

    return new Response(result.content, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
      },
    });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
