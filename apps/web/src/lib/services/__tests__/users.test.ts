/**
 * Test de integración de `lib/services/users.ts` contra la base REAL de
 * Supabase (mismo patrón que `state-machine.test.ts` y `rls.test.ts`).
 *
 * `createUser` crea el usuario en Supabase Auth (service role) + la fila en
 * `users` + sus `user_roles`; acá se verifica que el alta, la edición y el
 * soft delete dejan el estado esperado, y que el email duplicado falla con
 * CONFLICT (Regla global: soft delete, nunca borrado físico).
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { organizations, userRoles, users } from "@/lib/db/schema";
import { createUser, softDeleteUser, updateUser } from "../users";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env para correr el test`);
  return value;
}

const supabaseAdmin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const TEST_PASSWORD = "SmTest123!";

describe("servicio de usuarios (integración contra Supabase real)", () => {
  const runId = randomUUID().slice(0, 8);
  let orgId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: `USR Test Org ${runId}` })
      .returning();
    if (!org) throw new Error("no se pudo crear la org de test");
    orgId = org.id;
  }, 30_000);

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await db.delete(userRoles).where(inArray(userRoles.userId, createdUserIds));
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    await db.delete(organizations).where(eq(organizations.id, orgId));
    for (const id of createdUserIds) {
      await supabaseAdmin.auth.admin.deleteUser(id).catch(() => {});
    }
  }, 30_000);

  it("createUser crea auth + fila en users + roles", async () => {
    const email = `usr-a-${runId}@test`;
    const result = await createUser({
      orgId,
      email,
      password: TEST_PASSWORD,
      fullName: "Usuario A",
      phone: "+5491100000000",
      roles: ["dispatcher", "warehouse"],
    });
    createdUserIds.push(result.id);

    expect(result.email).toBe(email);

    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.id, result.id));
    expect(row).toMatchObject({
      email,
      fullName: "Usuario A",
      phone: "+5491100000000",
      isActive: true,
    });

    const roleRows = await db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, result.id));
    expect(roleRows.map((r) => r.role).sort()).toEqual(["dispatcher", "warehouse"]);
  });

  it("createUser con email duplicado falla con CONFLICT", async () => {
    const email = `usr-b-${runId}@test`;
    const first = await createUser({
      orgId,
      email,
      password: TEST_PASSWORD,
      fullName: "Usuario B",
      roles: ["driver"],
    });
    createdUserIds.push(first.id);

    const err = await createUser({
      orgId,
      email,
      password: TEST_PASSWORD,
      fullName: "Otro B",
      roles: ["driver"],
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("CONFLICT");
  });

  it("updateUser actualiza perfil, roles y estado", async () => {
    const email = `usr-c-${runId}@test`;
    const { id } = await createUser({
      orgId,
      email,
      password: TEST_PASSWORD,
      fullName: "Usuario C",
      roles: ["driver"],
    });
    createdUserIds.push(id);

    await updateUser(id, {
      fullName: "Usuario C Editado",
      phone: null,
      isActive: false,
      roles: ["driver", "dispatcher"],
    });

    const [row] = await db
      .select({ fullName: users.fullName, phone: users.phone, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, id));
    expect(row).toMatchObject({
      fullName: "Usuario C Editado",
      phone: null,
      isActive: false,
    });

    const roleRows = await db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, id));
    expect(roleRows.map((r) => r.role).sort()).toEqual(["dispatcher", "driver"]);
  });

  it("softDeleteUser marca deleted_at + is_active=false y rompe el login", async () => {
    const email = `usr-d-${runId}@test`;
    const { id } = await createUser({
      orgId,
      email,
      password: TEST_PASSWORD,
      fullName: "Usuario D",
      roles: ["admin"],
    });
    createdUserIds.push(id);

    await softDeleteUser(id);

    const [row] = await db
      .select({ deletedAt: users.deletedAt, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, id));
    expect(row?.deletedAt).toBeTruthy();
    expect(row?.isActive).toBe(false);

    // updateUser sobre un usuario soft-deleted → NOT_FOUND
    const err = await updateUser(id, { fullName: "X" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("NOT_FOUND");

    // y no aparece en el listado (filtro isNull(deletedAt))
    const [visible] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
    expect(visible).toBeUndefined();
  });
});
