/**
 * Tests de RLS contra la base REAL de Supabase (no un mock) — criterio de
 * aceptación de FASE 2: "tests automatizados que verifican que un driver
 * no puede leer paquetes de otra ruta, y que nadie puede hacer UPDATE
 * sobre events".
 *
 * Requiere DATABASE_URL + NEXT_PUBLIC_SUPABASE_URL + service/anon keys en
 * .env (correr con `pnpm test`, que ya carga .env vía dotenv-cli). Crea su
 * propia organización/usuarios de prueba (aislados del seed de demo) y los
 * borra al final.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../index";
import { organizations, packages, routes, users, userRoles, operations } from "../schema";

const TEST_PASSWORD = "RlsTest123!";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env para correr los tests de RLS`);
  return value;
}

const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function signInAs(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (error) throw error;
  return client;
}

describe("RLS (integración contra Supabase real)", () => {
  const runId = randomUUID().slice(0, 8);
  const orgName = `RLS Test Org ${runId}`;
  const driverAEmail = `rls-driver-a-${runId}@fyc.test`;
  const driverBEmail = `rls-driver-b-${runId}@fyc.test`;

  let orgId: string;
  let driverAId: string;
  let driverBId: string;
  let routeAId: string;
  let routeBId: string;
  let packageAId: string;
  let packageBId: string;

  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: orgName }).returning();
    if (!org) throw new Error("no se pudo crear la org de test");
    orgId = org.id;

    const { data: userA, error: errA } = await supabaseAdmin.auth.admin.createUser({
      email: driverAEmail,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (errA || !userA.user) throw errA ?? new Error("sin userA");
    driverAId = userA.user.id;

    const { data: userB, error: errB } = await supabaseAdmin.auth.admin.createUser({
      email: driverBEmail,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (errB || !userB.user) throw errB ?? new Error("sin userB");
    driverBId = userB.user.id;

    await db.insert(users).values([
      { id: driverAId, orgId, email: driverAEmail, fullName: "RLS Driver A" },
      { id: driverBId, orgId, email: driverBEmail, fullName: "RLS Driver B" },
    ]);
    await db.insert(userRoles).values([
      { userId: driverAId, role: "driver" },
      { userId: driverBId, role: "driver" },
    ]);

    const [operation] = await db
      .insert(operations)
      .values({ orgId, operationDate: "2026-08-11", status: "OPEN" })
      .returning();
    if (!operation) throw new Error("no se pudo crear la operación de test");

    const [routeA] = await db
      .insert(routes)
      .values({
        orgId,
        operationId: operation.id,
        routeNumber: 1,
        assignedDriverId: driverAId,
      })
      .returning();
    const [routeB] = await db
      .insert(routes)
      .values({
        orgId,
        operationId: operation.id,
        routeNumber: 2,
        assignedDriverId: driverBId,
      })
      .returning();
    if (!routeA || !routeB) throw new Error("no se pudieron crear las rutas de test");
    routeAId = routeA.id;
    routeBId = routeB.id;

    const [packageA] = await db
      .insert(packages)
      .values({
        orgId,
        internalCode: `RLS-A-${runId}`,
        routeId: routeAId,
        status: "ASIGNADO",
      })
      .returning();
    const [packageB] = await db
      .insert(packages)
      .values({
        orgId,
        internalCode: `RLS-B-${runId}`,
        routeId: routeBId,
        status: "ASIGNADO",
      })
      .returning();
    if (!packageA || !packageB)
      throw new Error("no se pudieron crear los paquetes de test");
    packageAId = packageA.id;
    packageBId = packageB.id;
  }, 30_000);

  afterAll(async () => {
    // Best-effort: borrar en orden por las FKs. Los paquetes/rutas/org
    // quedan huérfanos de todas formas si algo falla acá, pero no rompen
    // nada (son datos de test con nombres/emails únicos por corrida).
    //
    // `events` referencia a estos usuarios/org (actor_id/org_id) y es
    // append-only DE VERDAD — el trigger bloquea el DELETE incluso acá.
    // Para poder limpiar los eventos de test hay que desactivar el
    // trigger un instante (requiere ser el owner de la tabla, que es
    // exactamente lo que es esta conexión de administración — un cliente
    // normal de la app jamás podría hacer esto). Nunca hacer esto contra
    // datos reales, solo contra el fixture de este test.
    await db.execute(sql`ALTER TABLE events DISABLE TRIGGER events_forbid_delete`);
    await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`);
    await db.execute(sql`ALTER TABLE events ENABLE TRIGGER events_forbid_delete`);

    await db.delete(packages).where(sql`org_id = ${orgId}`);
    await db.delete(routes).where(sql`org_id = ${orgId}`);
    await db.delete(operations).where(sql`org_id = ${orgId}`);
    await db.delete(userRoles).where(sql`user_id in (${driverAId}, ${driverBId})`);
    await db.delete(users).where(sql`org_id = ${orgId}`);
    await db.delete(organizations).where(sql`id = ${orgId}`);
    await supabaseAdmin.auth.admin.deleteUser(driverAId).catch(() => {});
    await supabaseAdmin.auth.admin.deleteUser(driverBId).catch(() => {});
  }, 30_000);

  it("un driver ve los paquetes de SU ruta", async () => {
    const clientA = await signInAs(driverAEmail);
    const { data, error } = await clientA
      .from("packages")
      .select("id")
      .eq("id", packageAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("un driver NO puede leer paquetes de otra ruta (criterio de aceptación FASE 2)", async () => {
    const clientA = await signInAs(driverAEmail);
    const { data, error } = await clientA
      .from("packages")
      .select("id")
      .eq("id", packageBId);
    // RLS no tira error: filtra silenciosamente. 0 filas es el resultado correcto.
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("un driver NO puede leer la ruta de otro chofer", async () => {
    const clientA = await signInAs(driverAEmail);
    const { data, error } = await clientA.from("routes").select("id").eq("id", routeBId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("nadie puede hacer UPDATE sobre events, ni siquiera con la conexión de administración", async () => {
    const eventId = await db.execute(sql`
      select public.log_event(
        ${orgId}::uuid, 'PACKAGE'::event_entity_type, ${packageAId}::uuid, 'TEST_EVENT',
        ${driverAId}::uuid, 'driver', null, null, null, null, '{}'::jsonb, null, now()
      ) as id
    `);
    const insertedId = (eventId.rows[0] as { id: string }).id;
    expect(insertedId).toBeTruthy();

    // Drizzle envuelve el error de Postgres en un DrizzleError cuyo
    // `.message` es genérico ("Failed query: ..."); el mensaje real del
    // trigger (`forbid_events_mutation`) queda en `.cause`.
    const err = await db
      .execute(sql`update events set event_type = 'HACKED' where id = ${insertedId}`)
      .catch((e: unknown) => e as Error & { cause?: Error });
    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { cause?: Error }).cause?.message).toMatch(/append-only/i);
  });

  it("nadie puede hacer DELETE sobre events", async () => {
    const eventId = await db.execute(sql`
      select public.log_event(
        ${orgId}::uuid, 'PACKAGE'::event_entity_type, ${packageAId}::uuid, 'TEST_EVENT_2',
        ${driverAId}::uuid, 'driver', null, null, null, null, '{}'::jsonb, null, now()
      ) as id
    `);
    const insertedId = (eventId.rows[0] as { id: string }).id;

    const err = await db
      .execute(sql`delete from events where id = ${insertedId}`)
      .catch((e: unknown) => e as Error & { cause?: Error });
    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { cause?: Error }).cause?.message).toMatch(/append-only/i);
  });
});
