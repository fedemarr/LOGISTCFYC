/**
 * Tests de RLS del sistema FYM contra la base REAL de Supabase (no un
 * mock). Verifican el criterio de aceptación del sistema de control: un
 * chofer ve sus turnos/alertas/avances y NO los de otro chofer; nadie
 * puede hacer UPDATE/DELETE sobre `events` (append-only).
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
import {
  deliveryAlerts,
  devicePushTokens,
  driverShifts,
  organizations,
  shiftReports,
  users,
  userRoles,
  zoneAlerts,
  zones,
} from "../schema";
import { purgeTestEvents } from "../test-helpers";

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

describe("RLS FYM (integración contra Supabase real)", () => {
  const runId = randomUUID().slice(0, 8);
  const orgName = `RLS Test Org ${runId}`;
  const driverAEmail = `rls-driver-a-${runId}@fym.test`;
  const driverBEmail = `rls-driver-b-${runId}@fym.test`;

  let orgId: string;
  let driverAId: string;
  let driverBId: string;
  let shiftAId: string;
  let shiftBId: string;
  let zoneAId: string;
  let alertAId: string;
  let zoneBId: string;
  let alertBId: string;
  let reportAId: string;
  let deliveryAlertAId: string;
  let deliveryAlertBId: string;

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

    const [zoneA] = await db
      .insert(zones)
      .values({
        orgId,
        name: `Zona A ${runId}`,
        isActive: true,
        centerLat: -34.6037,
        centerLng: -58.3816,
        radiusM: 500,
      })
      .returning();
    const [zoneB] = await db
      .insert(zones)
      .values({
        orgId,
        name: `Zona B ${runId}`,
        isActive: true,
        centerLat: -34.6,
        centerLng: -58.38,
        radiusM: 500,
      })
      .returning();
    if (!zoneA || !zoneB) throw new Error("no se pudieron crear las zonas de test");
    zoneAId = zoneA.id;
    zoneBId = zoneB.id;

    const today = new Date().toISOString().slice(0, 10);
    const [shiftA] = await db
      .insert(driverShifts)
      .values({
        orgId,
        driverId: driverAId,
        zoneId: zoneAId,
        shiftDate: today,
        packageCount: 30,
        status: "ACTIVE",
      })
      .returning();
    const [shiftB] = await db
      .insert(driverShifts)
      .values({
        orgId,
        driverId: driverBId,
        zoneId: zoneBId,
        shiftDate: today,
        packageCount: 40,
        status: "ACTIVE",
      })
      .returning();
    if (!shiftA || !shiftB) throw new Error("no se pudieron crear los turnos de test");
    shiftAId = shiftA.id;
    shiftBId = shiftB.id;

    const [alertA] = await db
      .insert(zoneAlerts)
      .values({
        orgId,
        shiftId: shiftAId,
        driverId: driverAId,
        zoneId: zoneAId,
        alertType: "LEFT_ZONE",
        status: "OPEN",
        distanceOutsideM: 850,
      })
      .returning();
    const [alertB] = await db
      .insert(zoneAlerts)
      .values({
        orgId,
        shiftId: shiftBId,
        driverId: driverBId,
        zoneId: zoneBId,
        alertType: "LEFT_ZONE",
        status: "OPEN",
        distanceOutsideM: 1200,
      })
      .returning();
    if (!alertA || !alertB) throw new Error("no se pudieron crear las alertas de test");
    alertAId = alertA.id;
    alertBId = alertB.id;

    const [reportA] = await db
      .insert(shiftReports)
      .values({
        orgId,
        shiftId: shiftAId,
        driverId: driverAId,
        packagesDone: 12,
        note: "avance de test",
      })
      .returning();
    if (!reportA) throw new Error("no se pudo crear el avance de test");
    reportAId = reportA.id;

    const [deliveryA] = await db
      .insert(deliveryAlerts)
      .values({
        orgId,
        shiftId: shiftAId,
        driverId: driverAId,
        reason: "NOT_HOME",
        contactPhone: "+54 11 5555 0101",
        note: "no atendieron el portero",
        status: "OPEN",
      })
      .returning();
    const [deliveryB] = await db
      .insert(deliveryAlerts)
      .values({
        orgId,
        shiftId: shiftBId,
        driverId: driverBId,
        reason: "REFUSED",
        contactPhone: "+54 11 5555 0202",
        status: "OPEN",
      })
      .returning();
    if (!deliveryA || !deliveryB) {
      throw new Error("no se pudieron crear las alertas de entrega de test");
    }
    deliveryAlertAId = deliveryA.id;
    deliveryAlertBId = deliveryB.id;

    await db.insert(devicePushTokens).values({
      orgId,
      userId: driverAId,
      token: `web-${runId}`,
      platform: "web",
    });
  }, 30_000);

  afterAll(async () => {
    await purgeTestEvents(orgId);

    await db.delete(devicePushTokens).where(sql`org_id = ${orgId}`);
    await db.delete(deliveryAlerts).where(sql`driver_id in (${driverAId}, ${driverBId})`);
    await db.delete(shiftReports).where(sql`shift_id in (${shiftAId}, ${shiftBId})`);
    await db.delete(zoneAlerts).where(sql`driver_id in (${driverAId}, ${driverBId})`);
    await db.delete(driverShifts).where(sql`driver_id in (${driverAId}, ${driverBId})`);
    await db.delete(zones).where(sql`org_id = ${orgId}`);
    await db.delete(userRoles).where(sql`user_id in (${driverAId}, ${driverBId})`);
    await db.delete(users).where(sql`org_id = ${orgId}`);
    await db.delete(organizations).where(sql`id = ${orgId}`);
    await supabaseAdmin.auth.admin.deleteUser(driverAId).catch(() => {});
    await supabaseAdmin.auth.admin.deleteUser(driverBId).catch(() => {});
  }, 30_000);

  it("un chofer ve SU turno activo (driver_shifts)", async () => {
    const clientA = await signInAs(driverAEmail);
    const { data, error } = await clientA
      .from("driver_shifts")
      .select("id")
      .eq("id", shiftAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("un chofer NO puede leer el turno de otro chofer", async () => {
    const clientA = await signInAs(driverAEmail);
    const { data, error } = await clientA
      .from("driver_shifts")
      .select("id")
      .eq("id", shiftBId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("un chofer ve SUS propias alertas de geocerca", async () => {
    const clientA = await signInAs(driverAEmail);
    const { data, error } = await clientA
      .from("zone_alerts")
      .select("id")
      .eq("id", alertAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("un chofer NO ve las alertas de geocerca del otro (solo el admin las resuelve)", async () => {
    const clientA = await signInAs(driverAEmail);
    const { data, error } = await clientA
      .from("zone_alerts")
      .select("id")
      .eq("id", alertBId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("un chofer ve SUS alertas de entrega y NO las del otro chofer", async () => {
    const clientA = await signInAs(driverAEmail);
    const { data: own, error: errOwn } = await clientA
      .from("delivery_alerts")
      .select("id")
      .eq("id", deliveryAlertAId);
    expect(errOwn).toBeNull();
    expect(own).toHaveLength(1);

    const { data: other, error: errOther } = await clientA
      .from("delivery_alerts")
      .select("id")
      .eq("id", deliveryAlertBId);
    expect(errOther).toBeNull();
    expect(other).toHaveLength(0);
  });

  it("un chofer lee su propio avance y NO el de otro chofer", async () => {
    const clientA = await signInAs(driverAEmail);
    const { data: own, error: errOwn } = await clientA
      .from("shift_reports")
      .select("id")
      .eq("id", reportAId);
    expect(errOwn).toBeNull();
    expect(own).toHaveLength(1);

    const { data: other, error: errOther } = await clientA
      .from("shift_reports")
      .select("id")
      .eq("driver_id", driverBId);
    expect(errOther).toBeNull();
    expect(other).toHaveLength(0);
  });

  it("nadie puede hacer UPDATE sobre events, ni siquiera con la conexión de administración", async () => {
    const eventId = await db.execute(sql`
      select public.log_event(
        ${orgId}::uuid, 'SHIFT'::event_entity_type, ${shiftAId}::uuid, 'TEST_EVENT',
        ${driverAId}::uuid, 'driver', null, null, null, null, '{}'::jsonb, null, now()
      ) as id
    `);
    const insertedId = (eventId.rows[0] as { id: string }).id;
    expect(insertedId).toBeTruthy();

    const err = await db
      .execute(sql`update events set event_type = 'HACKED' where id = ${insertedId}`)
      .catch((e: unknown) => e as Error & { cause?: Error });
    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { cause?: Error }).cause?.message).toMatch(/append-only/i);
  });

  it("nadie puede hacer DELETE sobre events", async () => {
    const eventId = await db.execute(sql`
      select public.log_event(
        ${orgId}::uuid, 'ZONE'::event_entity_type, ${zoneAId}::uuid, 'TEST_EVENT_2',
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

  it("device_push_tokens es inaccesible para el cliente autenticado (sin políticas)", async () => {
    const clientA = await signInAs(driverAEmail);
    const { data, error } = await clientA.from("device_push_tokens").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});
