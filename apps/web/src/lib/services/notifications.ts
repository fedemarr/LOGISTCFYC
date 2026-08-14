/**
 * NOTIFICACIONES PUSH — PROMPT-MAESTRO §5 (FASE 12): notificar al chofer
 * cuando se resuelve una incidencia, se reprograma o se le asigna una
 * ruta. Usa Expo Notifications (push tokens Expo).
 *
 * El token de acceso de Expo va en `EXPO_ACCESS_TOKEN`. Si no está
 * configurado (dev local), el envío se registra en logs y no falla: la
 * persistencia del token ya se hizo en `device_push_tokens`.
 */
import { and, eq } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { logger } from "@/lib/api/logger";
import { db } from "@/lib/db";
import { devicePushTokens } from "@/lib/db/schema";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Registra (o refresca) el token push de un usuario en un dispositivo. */
export async function registerDeviceToken(
  orgId: string,
  userId: string,
  token: string,
  opts: { deviceId?: string; platform?: string } = {},
): Promise<{ registered: boolean }> {
  if (!token || token.length < 20) {
    throw Errors.validation("token push inválido");
  }

  const [existing] = await db
    .select({ id: devicePushTokens.id })
    .from(devicePushTokens)
    .where(and(eq(devicePushTokens.userId, userId), eq(devicePushTokens.token, token)))
    .limit(1);

  if (existing) {
    await db
      .update(devicePushTokens)
      .set({
        lastSeenAt: new Date(),
        deviceId: opts.deviceId ?? null,
        platform: opts.platform ?? null,
      })
      .where(eq(devicePushTokens.id, existing.id));
    return { registered: true };
  }

  await db.insert(devicePushTokens).values({
    orgId,
    userId,
    token,
    deviceId: opts.deviceId ?? null,
    platform: opts.platform ?? null,
  });
  return { registered: true };
}

/** Borra el token (logout o dispositivo dado de baja). */
export async function unregisterDeviceToken(
  orgId: string,
  userId: string,
  token: string,
): Promise<{ removed: boolean }> {
  await db
    .delete(devicePushTokens)
    .where(
      and(
        eq(devicePushTokens.orgId, orgId),
        eq(devicePushTokens.userId, userId),
        eq(devicePushTokens.token, token),
      ),
    );
  return { removed: true };
}

/** Lista de tokens push del usuario. */
export async function listDeviceTokens(orgId: string, userId: string): Promise<string[]> {
  const rows = await db
    .select({ token: devicePushTokens.token })
    .from(devicePushTokens)
    .where(and(eq(devicePushTokens.orgId, orgId), eq(devicePushTokens.userId, userId)));
  return rows.map((r) => r.token);
}

/** Envía una notificación push a un usuario (todos sus dispositivos). */
export async function sendPushToUser(
  orgId: string,
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; skipped: boolean }> {
  const tokens = await listDeviceTokens(orgId, userId);
  if (tokens.length === 0) {
    return { sent: 0, skipped: true };
  }

  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  if (!accessToken) {
    logger.info("push sin EXPO_ACCESS_TOKEN, envío omitido", {
      userId,
      title: payload.title,
    });
    return { sent: 0, skipped: true };
  }

  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      logger.warn("Expo Push rechazó el envío", { status: res.status });
      return { sent: 0, skipped: true };
    }
    return { sent: tokens.length, skipped: false };
  } catch (err) {
    logger.warn("error de red hacia Expo Push", { message: (err as Error).message });
    return { sent: 0, skipped: true };
  }
}

/**
 * Envía a TODOS los usuarios con un rol en la org (p.ej. "dispatcher").
 * Usado para alertar al staff de soporte/operaciones.
 */
export async function sendPushToRole(
  orgId: string,
  role: string,
  payload: PushPayload,
): Promise<{ sent: number }> {
  const { users, userRoles } = await import("@/lib/db/schema");
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(users.orgId, orgId), eq(userRoles.role, role as never)))
    .groupBy(users.id);

  let sent = 0;
  for (const u of rows) {
    const r = await sendPushToUser(orgId, u.id, payload);
    sent += r.sent;
  }
  return { sent };
}
