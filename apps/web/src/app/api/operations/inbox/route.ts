import { consumeRateLimit, jsonError, jsonOk, requireRole, toAppError } from "@/lib/api";
import { getDispatchInbox } from "@/lib/services/monitoring";

/**
 * GET /api/operations/inbox — FASE 11, bandeja de excepciones del
 * dispatcher (su pantalla principal): incidentes abiertos con SLA,
 * entregas a revisar (>150 m, anti-fraude §9.5) y actas de custodia en
 * diferencia sin resolver. Solo admin/dispatcher.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    await consumeRateLimit(`operations:inbox:${ctx.userId}`, {
      limit: 120,
      windowSeconds: 60,
    });

    const inbox = await getDispatchInbox(ctx.orgId);
    return jsonOk(inbox);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
