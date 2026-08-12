import { z } from "zod";
import { SYNC_OPERATION_TYPES } from "@fyc/shared";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseBody,
  requireRole,
  toAppError,
} from "@/lib/api";
import { processSyncBatch } from "@/lib/services/sync";

const actionSchema = z.object({
  idempotencyKey: z
    .string()
    .uuid("idempotencyKey debe ser un UUID (generado en el dispositivo)"),
  operationType: z.enum(SYNC_OPERATION_TYPES),
  payload: z.record(z.string(), z.unknown()),
  clientTimestamp: z.string().datetime({ message: "clientTimestamp debe ser ISO 8601" }),
});

const bodySchema = z.object({
  deviceId: z.string().min(1).max(200),
  actions: z.array(actionSchema).min(1).max(50),
});

/**
 * POST /api/sync — motor de sincronización offline-first (§12). El chofer
 * (o cualquier rol con app móvil) manda en lote lo que encoló localmente
 * mientras no tenía señal; el servidor dedupe por `idempotencyKey` y
 * devuelve el resultado POR ACCIÓN — el cliente solo borra del outbox
 * local las que vinieron `COMPLETED`/`DUPLICATE`; las `FAILED` quedan
 * para diagnóstico manual (no se reintentan solas: un payload inválido no
 * se arregla reintentando).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, [
      "driver",
      "warehouse",
      "dispatcher",
      "admin",
    ]);
    const body = await parseBody(bodySchema, request);

    await consumeRateLimit(`sync:${ctx.userId}`, { limit: 30, windowSeconds: 60 });

    const results = await processSyncBatch(ctx, body.deviceId, body.actions);
    return jsonOk({ results });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
