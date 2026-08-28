import { z } from "zod";
import { jsonError, jsonOk, parseBody, toAppError } from "@/lib/api";
import { Errors } from "@/lib/api/errors";
import { hashQrToken } from "@/lib/services/driver-qr";
import { getCurrentShiftForDriver } from "@/lib/services/shifts";
import { db } from "@/lib/db";
import { userRoles, users } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import type { Role } from "@fym/shared";

/**
 * SESIÓN DE LA PWA DEL CHOFER (FYM).
 * POST /api/chofer/session { token } → valida el QR y devuelve el perfil
 * del chofer + el turno activo (si tiene uno).
 *
 * La PWA escanea el QR (que abre `/chofer?t=<token>`), guarda el token y lo
 * manda acá para resolver la sesión. El token se transforma a hash y se
 * compara contra `users.qr_token_hash`.
 */

const bodySchema = z.object({
  token: z.string().min(10, "token inválido"),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(bodySchema, request);
    const tokenHash = hashQrToken(body.token);

    const rows = await db
      .select({
        id: users.id,
        orgId: users.orgId,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        isActive: users.isActive,
        role: userRoles.role,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .where(and(eq(users.qrTokenHash, tokenHash), eq(users.isActive, true)));

    const first = rows[0];
    if (!first) throw Errors.unauthorized("QR inválido o chofer desactivado");

    const roles = rows.map((r) => r.role).filter((r): r is Role => r !== null);
    if (!roles.includes("driver")) {
      throw Errors.forbidden("el usuario no tiene perfil de chofer");
    }

    const currentShift = await getCurrentShiftForDriver(first.id, first.orgId);

    return jsonOk({
      user: {
        id: first.id,
        email: first.email,
        fullName: first.fullName,
        phone: first.phone,
      },
      hasActiveShift: !!currentShift,
      activeShift: currentShift
        ? {
            id: currentShift.shift.id,
            startedAt: currentShift.shift.startedAt,
            status: currentShift.shift.status,
          }
        : null,
      now: new Date().toISOString(),
    });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
