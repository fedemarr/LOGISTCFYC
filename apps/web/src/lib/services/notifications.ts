import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { devicePushTokens } from "@/lib/db/schema";

/**
 * TOKENS DE PUSH (FYM–PWA).
 *
 * La PWA del chofer corre en el navegador → usa Web Push (not `device_push_tokens`
 * de Expo). El mismo schema sirve guardando el subscription JSON
 * `{ endpoint, keys: { p256dh, auth } }` como `token` con `platform: "web"`.
 *
 * Regla de seguridad: SOLO el dueño puede leer/borrar su token
 * (se filtra por `userId` en cada query).
 */

export async function registerDeviceToken(
  orgId: string,
  userId: string,
  token: string,
  opts: { deviceId?: string; platform?: string },
) {
  const [row] = await db
    .insert(devicePushTokens)
    .values({
      orgId,
      userId,
      token,
      deviceId: opts.deviceId ?? null,
      platform: opts.platform ?? "web",
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [devicePushTokens.userId, devicePushTokens.token],
      set: { lastSeenAt: new Date(), deviceId: opts.deviceId ?? null },
    })
    .returning();
  return row;
}

export async function unregisterDeviceToken(
  orgId: string,
  userId: string,
  token: string,
) {
  await db
    .delete(devicePushTokens)
    .where(
      and(
        eq(devicePushTokens.orgId, orgId),
        eq(devicePushTokens.userId, userId),
        eq(devicePushTokens.token, token),
      ),
    );
  return { ok: true };
}

export async function listDeviceTokens(orgId: string, userId: string) {
  return db
    .select()
    .from(devicePushTokens)
    .where(and(eq(devicePushTokens.orgId, orgId), eq(devicePushTokens.userId, userId)))
    .orderBy(desc(devicePushTokens.createdAt));
}

/**
 * Recupera los subscriptions Web Push de un chofer (para el job de aviso de
 * reporte, FASE 12/13). El envío real de push requiere credenciales VAPID —
 * se configura en FASE 13.
 */
export async function webPushSubscriptionsFor(orgId: string, driverId: string) {
  const rows = await listDeviceTokens(orgId, driverId);
  return rows
    .filter((r) => r.platform === "web")
    .map((r) => {
      try {
        const parsed = JSON.parse(r.token) as {
          endpoint: string;
          keys: { p256dh: string; auth: string };
        };
        if (!parsed.endpoint || !parsed.keys?.p256dh || !parsed.keys?.auth) return null;
        return { ...parsed, tokenId: r.id };
      } catch {
        return null;
      }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
}

export class NoWebPushConfiguredError extends Error {
  constructor() {
    super("web push sin credenciales VAPID");
  }
}
