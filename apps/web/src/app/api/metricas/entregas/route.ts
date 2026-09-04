import { z } from "zod";
import { jsonError, jsonOk, parseQuery, requireRole, toAppError } from "@/lib/api";
import { Errors } from "@/lib/api/errors";
import { listDeliveries } from "@/lib/services/orders";
import { signDeliveryEvidenceUrl } from "@/lib/storage";

/**
 * ENTREGAS (FYM) — admin/dispatcher. Pedido de Fede: "en métricas
 * necesito saber a quién le entregó el chofer, el DNI y el nombre —
 * por si pasa algo después tener esa info".
 * GET /api/metricas/entregas?from=&to= → un renglón por pedido
 * entregado en el período (fecha del turno), con quién lo recibió y el
 * link a la foto de evidencia si la hay.
 */

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  from: z.string().regex(dateRegex, "fecha inválida (YYYY-MM-DD)"),
  to: z.string().regex(dateRegex, "fecha inválida (YYYY-MM-DD)"),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const url = new URL(request.url);
    const query = parseQuery(querySchema, url);
    if (query.from > query.to) {
      throw Errors.validation("from no puede ser posterior a to");
    }

    const rows = await listDeliveries(ctx.orgId, query.from, query.to);
    const deliveries = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        evidencePhotoUrl: row.evidencePhotoPath
          ? await signDeliveryEvidenceUrl(row.evidencePhotoPath).catch(() => null)
          : null,
      })),
    );

    return jsonOk({ deliveries });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
