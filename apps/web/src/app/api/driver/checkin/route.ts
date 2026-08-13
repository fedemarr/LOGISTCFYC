import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseBody,
  requireRole,
  toAppError,
} from "@/lib/api";
import { checkInDriver } from "@/lib/services/driver-checkin";

const bodySchema = z.object({
  code: z.string().trim().min(1).max(200),
});

/**
 * POST /api/driver/checkin — depósito escanea el QR personal del chofer
 * (control de salida, pedido de Fede — ver `driver-checkin.ts`). No es
 * parte del flujo de custodia de bultos (§9.3), es un registro aparte.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const body = await parseBody(bodySchema, request);

    await consumeRateLimit(`driver:checkin:${ctx.userId}`, {
      limit: 60,
      windowSeconds: 60,
    });

    const result = await checkInDriver(ctx.orgId, body.code, ctx);
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
