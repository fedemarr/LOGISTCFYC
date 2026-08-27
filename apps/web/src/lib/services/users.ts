import { and, eq, isNull } from "drizzle-orm";
import type { Role } from "@fym/shared";
import { Errors } from "@/lib/api";
import { db } from "@/lib/db";
import { userRoles, users } from "@/lib/db/schema";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Servicio de usuarios del panel (FASE 4). El `users` del sistema es un
 * perfil cuyo `id` ES `auth.users.id`: crear un usuario = crear primero el
 * usuario en Supabase Auth (service role) y después su fila en `users` +
 * sus `user_roles`. Ver `apps/web/src/lib/db/schema/users.ts`.
 *
 * Los writes van por la conexión `postgres` (bypasea RLS — ADR-015); la
 * autorización real la hace `requireRole` en el Route Handler.
 */

export interface CreateUserInput {
  orgId: string;
  email: string;
  password: string;
  fullName: string;
  phone?: string | null;
  roles: readonly Role[];
}

export async function createUser(
  input: CreateUserInput,
): Promise<{ id: string; email: string }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (error) {
    throw Errors.conflict(`no se pudo crear el usuario de auth: ${error.message}`);
  }

  const id = data.user.id;
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id,
      orgId: input.orgId,
      email: input.email,
      fullName: input.fullName,
      phone: input.phone ?? null,
    });
    if (input.roles.length > 0) {
      await tx
        .insert(userRoles)
        .values(input.roles.map((role) => ({ userId: id, role })));
    }
  });

  return { id, email: input.email };
}

export interface UpdateUserInput {
  email?: string;
  fullName?: string;
  phone?: string | null;
  isActive?: boolean;
  roles?: readonly Role[];
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<void> {
  if (input.email !== undefined) {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.auth.admin.updateUserById(id, {
      email: input.email,
    });
    if (error) {
      throw Errors.conflict(`no se pudo actualizar el email de auth: ${error.message}`);
    }
  }

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
    if (!existing) {
      throw Errors.notFound("usuario no encontrado");
    }

    const patch: Partial<typeof users.$inferSelect> = {};
    if (input.email !== undefined) patch.email = input.email;
    if (input.fullName !== undefined) patch.fullName = input.fullName;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    if (Object.keys(patch).length > 0) {
      await tx.update(users).set(patch).where(eq(users.id, id));
    }

    if (input.roles !== undefined) {
      await tx.delete(userRoles).where(eq(userRoles.userId, id));
      if (input.roles.length > 0) {
        await tx
          .insert(userRoles)
          .values(input.roles.map((role) => ({ userId: id, role })));
      }
    }
  });
}

/** Soft delete (regla global del proyecto): `deleted_at` + desactiva login. */
export async function softDeleteUser(id: string): Promise<void> {
  await db
    .update(users)
    .set({ deletedAt: new Date(), isActive: false })
    .where(and(eq(users.id, id), isNull(users.deletedAt)));
}
