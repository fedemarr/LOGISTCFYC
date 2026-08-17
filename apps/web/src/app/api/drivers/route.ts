import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { jsonError, jsonOk, requireRole, toAppError } from "@/lib/api";
import { db } from "@/lib/db";
import { userRoles, users } from "@/lib/db/schema";

/**
 * GET /api/drivers — listado liviano de choferes activos para asignarlos a
 * una ruta desde Ruteo (FASE A). El listado completo de usuarios sigue
 * siendo admin-only (`/api/users`, matriz §3) — acá solo se expone lo que
 * necesita el flujo operativo, como ya pasa con `/api/vehicles`.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const idsWithRole = db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.role, "driver"));

    const rows = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email })
      .from(users)
      .where(
        and(
          eq(users.orgId, ctx.orgId),
          eq(users.isActive, true),
          isNull(users.deletedAt),
          inArray(users.id, idsWithRole),
        ),
      )
      .orderBy(asc(users.fullName));

    return jsonOk({ items: rows });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
