import { and, eq, isNull } from "drizzle-orm";
import { jsonError, jsonOk, requireRole, toAppError } from "@/lib/api";
import { db } from "@/lib/db";
import { userRoles, users } from "@/lib/db/schema";

/**
 * CHOFERES (FYM) — admin/dispatcher.
 * GET /api/choferes → lista choferes (con QR asignado o no + roles) de la org.
 */

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        isActive: users.isActive,
        qrIssued: users.qrTokenHash,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(
        and(
          eq(userRoles.role, "driver"),
          eq(users.orgId, ctx.orgId),
          isNull(users.deletedAt),
        ),
      )
      .orderBy(users.fullName);

    const drivers = rows.map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.fullName,
      phone: r.phone,
      isActive: r.isActive,
      hasQr: !!r.qrIssued,
    }));

    return jsonOk({ drivers });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
