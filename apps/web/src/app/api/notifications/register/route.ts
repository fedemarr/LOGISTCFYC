import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseBody,
  requireRole,
  toAppError,
} from "@/lib/api";
import {
  listDeviceTokens,
  registerDeviceToken,
  unregisterDeviceToken,
} from "@/lib/services/notifications";

const bodySchema = z.object({
  token: z.string().min(20, "token push inválido"),
  deviceId: z.string().optional(),
  platform: z.enum(["android", "ios", "web"]).optional(),
});

/**
 * POST /api/notifications/register — FASE 12 §5: la app del chofer (o el
 * web) registra su token Expo Push al loguear/arrancar. Idempotente por
 * (userId, token).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, [
      "admin",
      "dispatcher",
      "warehouse",
      "driver",
    ]);
    const body = await parseBody(bodySchema, request);

    await consumeRateLimit(`notifications:register:${ctx.userId}`, {
      limit: 20,
      windowSeconds: 60,
    });

    const result = await registerDeviceToken(ctx.orgId, ctx.userId, body.token, {
      deviceId: body.deviceId,
      platform: body.platform,
    });
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

/**
 * DELETE /api/notifications/register — logout o baja de dispositivo:
 * borra el token de este usuario.
 */
export async function DELETE(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, [
      "admin",
      "dispatcher",
      "warehouse",
      "driver",
    ]);
    const body = await parseBody(bodySchema, request);

    await consumeRateLimit(`notifications:unregister:${ctx.userId}`, {
      limit: 20,
      windowSeconds: 60,
    });

    const result = await unregisterDeviceToken(ctx.orgId, ctx.userId, body.token);
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

/**
 * GET /api/notifications/register — lista tokens del usuario actual
 * (diagnóstico, sin exponer el token en sí fuera de la propia sesión).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, [
      "admin",
      "dispatcher",
      "warehouse",
      "driver",
    ]);
    const tokens = await listDeviceTokens(ctx.orgId, ctx.userId);
    return jsonOk({ count: tokens.length });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
