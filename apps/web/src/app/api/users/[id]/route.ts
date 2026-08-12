import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  Errors,
  jsonError,
  jsonOk,
  parseBody,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { db } from "@/lib/db";
import { userRoles, users } from "@/lib/db/schema";
import { softDeleteUser, updateUser } from "@/lib/services/users";

/**
 * GET /api/users/:id — perfil completo de un usuario (admin).
 * PATCH /api/users/:id — edita perfil, roles y estado de un usuario.
 * DELETE /api/users/:id — soft delete (`deleted_at` + desactiva login).
 */
const paramsSchema = z.object({
  id: z.string().uuid("id de usuario inválido"),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin"]);
    const { id } = await parseParams(paramsSchema, params);

    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(eq(users.id, id), eq(users.orgId, ctx.orgId), isNull(users.deletedAt)));
    if (!row) throw Errors.notFound("usuario no encontrado");

    const roleRows = await db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, id));

    return jsonOk({ ...row, roles: roleRows.map((r) => r.role) });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

const patchSchema = z.object({
  email: z.string().trim().toLowerCase().email("email inválido").optional(),
  fullName: z.string().trim().min(1, "el nombre es obligatorio").optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  isActive: z.boolean().optional(),
  roles: z
    .array(z.enum(["admin", "dispatcher", "warehouse", "driver"]))
    .min(1)
    .optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireRole(request, ["admin"]);
    const { id } = await parseParams(paramsSchema, params);
    const body = await parseBody(patchSchema, request);

    await updateUser(id, body);

    return jsonOk({ id });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireRole(request, ["admin"]);
    const { id } = await parseParams(paramsSchema, params);

    await softDeleteUser(id);

    return jsonOk({ id });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
