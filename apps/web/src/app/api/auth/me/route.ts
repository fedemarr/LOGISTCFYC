import { and, eq, isNull } from "drizzle-orm";
import { Errors, jsonError, jsonOk, requireUser, toAppError } from "@/lib/api";
import { db } from "@/lib/db";
import { organizations, userRoles, users } from "@/lib/db/schema";

/**
 * GET /api/auth/me — identidad del usuario logueado (FASE 4). El app shell
 * lo llama al entrar para resolver roles y `orgId` y así renderizar el
 * sidebar por rol y autorizar las vistas. Reusa el mismo `requireUser` de
 * la API: el middleware de `/api/*` ya validó el JWT y puso el
 * `x-fym-user-id`.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireUser(request);

    const [userRow, orgRow] = await Promise.all([
      db
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          phone: users.phone,
          isActive: users.isActive,
        })
        .from(users)
        .where(and(eq(users.id, ctx.userId), isNull(users.deletedAt)))
        .limit(1),
      db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, ctx.orgId))
        .limit(1),
    ]);

    const user = userRow[0];
    if (!user) {
      return jsonError(Errors.notFound("el perfil del usuario no existe"));
    }

    const roles = await db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, ctx.userId));

    return jsonOk({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        roles: roles.map((r) => r.role),
      },
      orgName: orgRow[0]?.name ?? null,
    });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
