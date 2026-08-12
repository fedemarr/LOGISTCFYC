/**
 * `processSyncBatch` — integración contra Supabase real, mismo patrón que
 * `ingestion.test.ts`. Cubre el criterio de aceptación de FASE 7 (§14):
 * "modo avión, registrar 5 acciones, restaurar conexión, verificar que
 * las 5 llegan exactamente una vez" — acá se simula reenviando el mismo
 * lote dos veces, como haría el motor de sync del dispositivo al
 * reintentar tras reconectar.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import type { SyncAction } from "@fyc/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import { db } from "@/lib/db";
import {
  driverLocations,
  organizations,
  syncQueue,
  userRoles,
  users,
} from "@/lib/db/schema";
import { processSyncBatch } from "../sync";

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

describe("processSyncBatch (integración contra Supabase real)", () => {
  const runId = randomUUID().slice(0, 8);
  let orgId: string;
  let driverId: string;
  let ctx: AuthContext;
  const deviceId = `device-${runId}`;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: `Sync Test Org ${runId}` })
      .returning();
    if (!org) throw new Error("no se pudo crear la org de test");
    orgId = org.id;

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: `sync-driver-${runId}@test`,
      password: "SyncTest123!",
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("sin usuario");
    driverId = data.user.id;

    await db.insert(users).values({
      id: driverId,
      orgId,
      email: `sync-driver-${runId}@test`,
      fullName: "Sync Driver",
    });
    await db.insert(userRoles).values({ userId: driverId, role: "driver" });

    ctx = {
      userId: driverId,
      orgId,
      email: `sync-driver-${runId}@test`,
      roles: ["driver"],
    };
  }, 30_000);

  afterAll(async () => {
    await db.delete(syncQueue).where(eq(syncQueue.userId, driverId));
    await db.delete(driverLocations).where(eq(driverLocations.driverId, driverId));
    await db.delete(userRoles).where(eq(userRoles.userId, driverId));
    await db.delete(users).where(eq(users.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await supabaseAdmin.auth.admin.deleteUser(driverId).catch(() => {});
  }, 30_000);

  it("aplica un GPS_PING válido y lo marca COMPLETED", async () => {
    const action: SyncAction = {
      idempotencyKey: randomUUID(),
      operationType: "GPS_PING",
      payload: { lat: -34.5489, lng: -58.5645, accuracyM: 12, isMoving: true },
      clientTimestamp: new Date().toISOString(),
    };

    const [result] = await processSyncBatch(ctx, deviceId, [action]);
    expect(result?.status).toBe("COMPLETED");

    const rows = await db
      .select()
      .from(driverLocations)
      .where(eq(driverLocations.driverId, driverId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lat).toBeCloseTo(-34.5489);
  });

  it("reenviar la MISMA acción (mismo idempotencyKey) da DUPLICATE y no crea una segunda fila", async () => {
    const action: SyncAction = {
      idempotencyKey: randomUUID(),
      operationType: "GPS_PING",
      payload: { lat: -34.55, lng: -58.56 },
      clientTimestamp: new Date().toISOString(),
    };

    const first = await processSyncBatch(ctx, deviceId, [action]);
    expect(first[0]?.status).toBe("COMPLETED");

    const second = await processSyncBatch(ctx, deviceId, [action]);
    expect(second[0]?.status).toBe("DUPLICATE");

    const rows = await db
      .select()
      .from(syncQueue)
      .where(eq(syncQueue.idempotencyKey, action.idempotencyKey));
    expect(rows).toHaveLength(1); // una sola fila en la cola, no dos
  });

  it("un payload inválido queda FAILED con el error, sin abortar el resto del lote", async () => {
    const bad: SyncAction = {
      idempotencyKey: randomUUID(),
      operationType: "GPS_PING",
      payload: { lat: 999, lng: -58.5 }, // lat fuera de rango
      clientTimestamp: new Date().toISOString(),
    };
    const good: SyncAction = {
      idempotencyKey: randomUUID(),
      operationType: "GPS_PING",
      payload: { lat: -34.5, lng: -58.5 },
      clientTimestamp: new Date().toISOString(),
    };

    const results = await processSyncBatch(ctx, deviceId, [bad, good]);
    expect(results.find((r) => r.idempotencyKey === bad.idempotencyKey)?.status).toBe(
      "FAILED",
    );
    expect(results.find((r) => r.idempotencyKey === good.idempotencyKey)?.status).toBe(
      "COMPLETED",
    );

    const [failedRow] = await db
      .select({ lastError: syncQueue.lastError, status: syncQueue.status })
      .from(syncQueue)
      .where(eq(syncQueue.idempotencyKey, bad.idempotencyKey));
    expect(failedRow?.status).toBe("FAILED");
    expect(failedRow?.lastError).toBeTruthy();
  });

  it("criterio de aceptación FASE 7: 5 acciones en modo avión, reconectar y reenviar el mismo lote — llegan exactamente una vez", async () => {
    const actions: SyncAction[] = Array.from({ length: 5 }, (_, i) => ({
      idempotencyKey: randomUUID(),
      operationType: "GPS_PING",
      payload: { lat: -34.5 + i * 0.001, lng: -58.5 + i * 0.001 },
      clientTimestamp: new Date().toISOString(),
    }));

    // "modo avión": las 5 se encolan localmente y recién ahora se mandan.
    const firstAttempt = await processSyncBatch(ctx, deviceId, actions);
    expect(firstAttempt.every((r) => r.status === "COMPLETED")).toBe(true);

    // "restaurar conexión": el motor de sync reintenta el mismo lote (no
    // sabe con certeza si el envío anterior llegó) — comportamiento real
    // del patrón outbox, no un caso hipotético.
    const retryAttempt = await processSyncBatch(ctx, deviceId, actions);
    expect(retryAttempt.every((r) => r.status === "DUPLICATE")).toBe(true);

    const idempotencyKeys = actions.map((a) => a.idempotencyKey);
    const rows = await db
      .select()
      .from(syncQueue)
      .where(sql`idempotency_key IN ${idempotencyKeys}`);
    expect(rows).toHaveLength(5); // exactamente una vez, no diez
  });
});
