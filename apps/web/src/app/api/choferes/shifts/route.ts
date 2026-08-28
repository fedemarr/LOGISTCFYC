import { jsonError, jsonOk, requireRole, toAppError } from "@/lib/api";
import { listPendingShifts } from "@/lib/services/shifts";
import { signFlexScreenshotUrl } from "@/lib/storage";

/**
 * TURNOS PENDIENTES (FYM) — admin/dispatcher/warehouse ("depósito").
 * GET /api/choferes/shifts → turnos esperando confirmación (pedido de
 * Fede: "pago x paquete") — con la captura de Flex firmada y lo que leyó
 * la IA, si llegó a analizarla.
 */

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const pending = await listPendingShifts(ctx.orgId);

    const items = await Promise.all(
      pending.map(async (p) => ({
        id: p.id,
        packageCount: p.packageCount,
        startedAt: p.startedAt,
        driver: p.driver,
        zone: p.zone,
        aiAnalysis: p.aiAnalysis,
        screenshotUrl: p.flexScreenshotPath
          ? await signFlexScreenshotUrl(p.flexScreenshotPath).catch(() => null)
          : null,
      })),
    );

    return jsonOk({ items });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
