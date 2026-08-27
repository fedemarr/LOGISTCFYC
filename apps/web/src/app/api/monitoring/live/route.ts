import { z } from "zod";
import { jsonError, jsonOk, parseQuery, requireRole, toAppError } from "@/lib/api";
import { monitoringLive } from "@/lib/services/shifts";

/**
 * MONITOREO EN VIVO (FYM) — admin/dispatcher.
 * GET /api/monitoring/live → estado de TODOS los choferes con turno activo:
 * última ubicación, zona, minutos sin GPS, afuera/adentro de la geocerca,
 * y si el reporte de avance quedó vencido.
 */

const querySchema = z.object({});

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const url = new URL(request.url);
    parseQuery(querySchema, url);

    const fleet = await monitoringLive(ctx.orgId);
    const now = new Date();

    return jsonOk({
      fleet,
      now: now.toISOString(),
      gpsSilenceMinutes: 5,
    });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
