import { and, eq, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import type { Role } from "@fym/shared";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { users, userRoles } from "@/lib/db/schema";
import { logDomainEvent } from "@/lib/services/events";

/** Hash del token del QR — lo que se guarda en `users.qr_token_hash`. */
export function hashQrToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

/**
 * AUTH DE LA PWA DEL CHOFER (QR)
 *
 * La PWA del chofer no tiene sesión de Supabase: se autentica con el token
 * contenido en su QR (`users.qr_token_hash`). Esas rutas viven bajo
 * `/api/chofer/*` y el middleware las deja pasar (ver `middleware.ts`);
 * acá se resuelve la identidad desde el `Authorization: Bearer <token>`.
 */

export type DriverAuthContext = {
  userId: string;
  orgId: string;
  email: string;
  roles: readonly Role[];
  tokenHash: string;
};

export async function requireDriver(request: Request): Promise<DriverAuthContext> {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : null;
  if (!token) throw Errors.unauthorized("token de chofer no enviado");

  const tokenHash = createHash("sha256").update(token).digest("hex");

  const rows = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      email: users.email,
      role: userRoles.role,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(users.qrTokenHash, tokenHash), eq(users.isActive, true)));

  const first = rows[0];
  if (!first) {
    throw Errors.unauthorized("QR inválido o chofer desactivado");
  }

  return {
    userId: first.id,
    orgId: first.orgId,
    email: first.email,
    roles: rows.map((r) => r.role).filter((role): role is Role => role !== null),
    tokenHash,
  };
}

/**
 * Genera/rota el QR de un chofer (admin). Devuelve el TOKEN EN CLARO una
 * sola vez (para armar la URL/QR) — en la base solo queda el hash.
 */
export async function rotateDriverQr(
  orgId: string,
  userId: string,
  actor: { actorId: string; actorRole: string },
  log = logDomainEvent,
): Promise<{ token: string; hash: string }> {
  const [driver] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.orgId, orgId), isNull(users.deletedAt)));
  if (!driver) throw Errors.notFound("chofer no encontrado");

  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");

  await db
    .update(users)
    .set({ qrTokenHash: hash, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await db.transaction(async (tx) => {
    await log(
      {
        orgId,
        entityType: "USER",
        entityId: userId,
        eventType: "DRIVER_QR_ROTATED",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        occurredAt: new Date(),
      },
      tx,
    );
  });

  return { token, hash };
}
