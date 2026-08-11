/**
 * Test de integración de `runPackageTransition` contra la base REAL de
 * Supabase (mismo patrón que `rls.test.ts`): verifica que una transición
 * legal cambia el estado Y escribe el evento en la MISMA transacción, y que
 * las ilegales/no autorizadas/con precondición fallida no cambian nada ni
 * dejan eventos huérfanos (rollback real).
 *
 * Los actores de los eventos son `users.id`, que tiene FK a `auth.users`
 * (`users_id_auth_users_id_fk`), así que los usuarios de prueba se crean de
 * verdad en Supabase Auth con la service role key y se borran al final.
 */
import { randomUUID } from "node:crypto";
import {
  ForbiddenTransitionError,
  IllegalTransitionError,
  PreconditionFailedError,
} from "@lastmile/state-machine";
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { events, organizations, packages, userRoles, users } from "@/lib/db/schema";
import { runPackageTransition } from "../state-machine";

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

describe("runPackageTransition (integración contra Supabase real)", () => {
  const runId = randomUUID().slice(0, 8);
  let orgId: string;
  let adminId: string;
  let driverId: string;
  let geoPackageId: string;
  let geoForbiddenId: string;
  let atDoorId: string;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: `SM Test Org ${runId}` })
      .returning();
    if (!org) throw new Error("no se pudo crear la org de test");
    orgId = org.id;

    const createAuthUser = async (email: string): Promise<string> => {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw error ?? new Error(`sin usuario ${email}`);
      return data.user.id;
    };

    adminId = await createAuthUser(`sm-admin-${runId}@test`);
    driverId = await createAuthUser(`sm-driver-${runId}@test`);

    await db.insert(users).values([
      { id: adminId, orgId, email: `sm-admin-${runId}@test`, fullName: "SM Admin" },
      { id: driverId, orgId, email: `sm-driver-${runId}@test`, fullName: "SM Driver" },
    ]);
    await db.insert(userRoles).values([
      { userId: adminId, role: "admin" },
      { userId: driverId, role: "driver" },
    ]);

    const seed = async (
      internalCode: string,
      status: typeof packages.$inferInsert.status,
    ) => {
      const [pkg] = await db
        .insert(packages)
        .values({ orgId, internalCode, status })
        .returning();
      if (!pkg) throw new Error(`no se pudo crear ${internalCode}`);
      return pkg.id;
    };

    geoPackageId = await seed(`SM-GEO-${runId}`, "GEOCODIFICADO");
    geoForbiddenId = await seed(`SM-FORB-${runId}`, "GEOCODIFICADO");
    atDoorId = await seed(`SM-DOOR-${runId}`, "EN_DOMICILIO");
  }, 30_000);

  afterAll(async () => {
    await db.execute(sql`ALTER TABLE events DISABLE TRIGGER events_forbid_delete`);
    await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`);
    await db.execute(sql`ALTER TABLE events ENABLE TRIGGER events_forbid_delete`);

    await db.delete(packages).where(sql`org_id = ${orgId}`);
    await db.delete(userRoles).where(sql`user_id in (${adminId}, ${driverId})`);
    await db.delete(users).where(sql`org_id = ${orgId}`);
    await db.delete(organizations).where(sql`id = ${orgId}`);
    await supabaseAdmin.auth.admin.deleteUser(adminId).catch(() => {});
    await supabaseAdmin.auth.admin.deleteUser(driverId).catch(() => {});
  }, 30_000);

  async function packageStatus(packageId: string): Promise<string | undefined> {
    const [row] = await db
      .select({ status: packages.status })
      .from(packages)
      .where(eq(packages.id, packageId));
    return row?.status;
  }

  async function countEvents(packageId: string): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(events)
      .where(sql`entity_id = ${packageId}::uuid`);
    return row?.n ?? 0;
  }

  it("transición legal GEOCODIFICADO → ASIGNADO cambia el estado y escribe el evento (misma transacción)", async () => {
    const result = await runPackageTransition({
      packageId: geoPackageId,
      toStatus: "ASIGNADO",
      actorId: adminId,
      actorRoles: ["admin"],
    });

    expect(result.eventId).toBeTruthy();
    expect(result.fromStatus).toBe("GEOCODIFICADO");
    expect(result.toStatus).toBe("ASIGNADO");

    expect(await packageStatus(geoPackageId)).toBe("ASIGNADO");

    const [event] = await db.select().from(events).where(eq(events.id, result.eventId));
    expect(event).toBeDefined();
    if (!event) throw new Error("el evento no se escribió");
    expect(event.entityType).toBe("PACKAGE");
    expect(event.entityId).toBe(geoPackageId);
    expect(event.eventType).toBe("PACKAGE_STATUS_CHANGED");
    expect(event.actorId).toBe(adminId);
    expect(event.previousState).toBe("GEOCODIFICADO");
    expect(event.newState).toBe("ASIGNADO");
  });

  it("transición ilegal (GEOCODIFICADO → ENTREGADO) falla y NO deja evento ni cambio de estado", async () => {
    await expect(
      runPackageTransition({
        packageId: geoForbiddenId,
        toStatus: "ENTREGADO",
        actorId: adminId,
        actorRoles: ["admin"],
      }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);

    expect(await packageStatus(geoForbiddenId)).toBe("GEOCODIFICADO");
    expect(await countEvents(geoForbiddenId)).toBe(0);
  });

  it("transición sin permiso del rol (chofer asignando) falla y NO deja evento", async () => {
    await expect(
      runPackageTransition({
        packageId: geoForbiddenId,
        toStatus: "ASIGNADO",
        actorId: driverId,
        actorRoles: ["driver"],
      }),
    ).rejects.toBeInstanceOf(ForbiddenTransitionError);

    expect(await packageStatus(geoForbiddenId)).toBe("GEOCODIFICADO");
    expect(await countEvents(geoForbiddenId)).toBe(0);
  });

  it("ENTREGADO sin evidencia (nombre + GPS) falla la precondición", async () => {
    await expect(
      runPackageTransition({
        packageId: atDoorId,
        toStatus: "ENTREGADO",
        actorId: driverId,
        actorRoles: ["driver"],
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(PreconditionFailedError);

    expect(await packageStatus(atDoorId)).toBe("EN_DOMICILIO");
    expect(await countEvents(atDoorId)).toBe(0);
  });

  it("ENTREGADO con evidencia + GPS cambia el estado y guarda lat/lng en el evento", async () => {
    const result = await runPackageTransition({
      packageId: atDoorId,
      toStatus: "ENTREGADO",
      actorId: driverId,
      actorRoles: ["driver"],
      metadata: {
        receiverName: "Juan Pérez",
        gps: { lat: -34.6037, lng: -58.3816 },
      },
    });

    expect(result.toStatus).toBe("ENTREGADO");
    expect(await packageStatus(atDoorId)).toBe("ENTREGADO");

    const [event] = await db.select().from(events).where(eq(events.id, result.eventId));
    expect(event).toBeDefined();
    if (!event) throw new Error("el evento no se escribió");
    expect(event.lat).toBe(-34.6037);
    expect(event?.lng).toBe(-58.3816);
    expect(event?.metadata).toMatchObject({ receiverName: "Juan Pérez" });
  });

  it("paquete inexistente → AppError NOT_FOUND", async () => {
    const err = await runPackageTransition({
      packageId: randomUUID(),
      toStatus: "RECIBIDO",
      actorId: adminId,
      actorRoles: ["admin"],
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("NOT_FOUND");
  });
});
