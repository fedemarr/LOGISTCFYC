import { and, eq } from "drizzle-orm";
import type { Role } from "@fym/shared";
import { db } from "@/lib/db";
import { users, userRoles } from "@/lib/db/schema";
import { Errors } from "./errors";

/**
 * Autorización del backend (PROMPT-MAESTRO §14 FASE 3). Recordar ADR-015:
 * la conexión de `apps/web` a Postgres usa `DATABASE_URL` como usuario
 * `postgres`, que bypasea RLS por completo — RLS protege los accesos
 * directos del cliente (JWT de Supabase), NO al backend. Esta es la
 * autorización real para los Route Handlers.
 *
 * `requireUser`/`requireRole` confían en el header `x-fym-user-id`
 * que setea `apps/web/src/middleware.ts` después de verificar la sesión de
 * Supabase (el middleware SIEMPRE sobrescribe el header que manda el
 * cliente). Si el middleware no corre (ruta fuera del matcher), no hay
 * header → 401. Frontera de confianza documentada en docs/API.md.
 */

const USER_ID_HEADER = "x-fym-user-id";

export interface AuthContext {
  userId: string;
  orgId: string;
  email: string;
  roles: readonly Role[];
}

/** Verifica que la request traiga un usuario autenticado y activo. */
export async function requireUser(request: Request): Promise<AuthContext> {
  const userId = request.headers.get(USER_ID_HEADER);
  if (!userId) {
    throw Errors.unauthorized("sesión inválida o expirada");
  }

  const rows = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      email: users.email,
      isActive: users.isActive,
      role: userRoles.role,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(users.id, userId), eq(users.isActive, true)));

  const first = rows[0];
  if (!first) {
    throw Errors.unauthorized("el usuario no existe o fue desactivado");
  }

  const roles = rows.map((row) => row.role).filter((role): role is Role => role !== null);

  return { userId: first.id, orgId: first.orgId, email: first.email, roles };
}

/**
 * `requireUser` + check de que el usuario tenga al menos UNO de los roles
 * indicados (un usuario puede tener varios, PROMPT-MAESTRO §3).
 */
export async function requireRole(
  request: Request,
  allowedRoles: readonly Role[],
): Promise<AuthContext> {
  const ctx = await requireUser(request);
  if (!ctx.roles.some((role) => (allowedRoles as readonly string[]).includes(role))) {
    throw Errors.forbidden(
      `se requiere uno de los roles: ${(allowedRoles as string[]).join(", ")}`,
    );
  }
  return ctx;
}

/**
 * Convierte un `AuthContext` (de `requireRole`) en un actor para los
 * helpers de los servicios FYM, que esperan `{ actorId, actorRole }` (una
 * cadena uniendo los roles con coma para `log_event`).
 */
export function actorFrom(ctx: AuthContext): { actorId: string; actorRole: string } {
  return { actorId: ctx.userId, actorRole: ctx.roles.join(",") };
}
