/**
 * Tests de integración contra Supabase real. `GOOGLE_GEOCODING_API_KEY` SÍ
 * está configurada en este entorno (§18) — el camino "not_configured" (§16:
 * "Geocoding falla → Marca FAILED, va a revisión manual") se prueba
 * apagando la env var puntualmente para ese test, no asumiendo que nunca
 * hay key cargada. Los caminos de caché/known_addresses se testean
 * pre-sembrando esas tablas, así nunca dependen de la red ni de la key real.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { hashNormalizedAddress } from "@fyc/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  geocodeCache,
  knownAddresses,
  operations,
  organizations,
  packages,
  userRoles,
  users,
} from "@/lib/db/schema";
import { purgeTestEvents } from "@/lib/db/test-helpers";
import { geocodeAddress, geocodeOperationPackages } from "../geocoding";

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
const TEST_PASSWORD = "GeoTest123!";

describe("geocodeAddress (integración contra Supabase real)", () => {
  const runId = randomUUID().slice(0, 8);
  let orgId: string;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: `Geo Test Org ${runId}` })
      .returning();
    if (!org) throw new Error("no se pudo crear la org de test");
    orgId = org.id;
  }, 15_000);

  afterAll(async () => {
    await db.delete(knownAddresses).where(sql`org_id = ${orgId}`);
    await db.delete(organizations).where(sql`id = ${orgId}`);
  }, 15_000);

  it("reusa known_addresses si ya existe (costo cero, no llama a Google)", async () => {
    const rawText = `Perú 880, Villa Ballester ${runId}`;
    const hash = await hashNormalizedAddress(rawText);
    await db.insert(knownAddresses).values({
      orgId,
      normalizedHash: hash,
      rawText,
      lat: -34.55,
      lng: -58.56,
      geocodeAccuracy: "ROOFTOP",
      geocodeSource: "test-seed",
    });

    const result = await geocodeAddress(rawText);
    expect(result).toMatchObject({
      lat: -34.55,
      lng: -58.56,
      accuracy: "ROOFTOP",
      source: "known_address",
    });
  });

  it("reusa geocode_cache si ya está cacheado (sin known_address todavía)", async () => {
    const rawText = `Alvear 1502, Villa Ballester ${runId}`;
    const hash = await hashNormalizedAddress(rawText);
    await db.insert(geocodeCache).values({
      queryHash: hash,
      provider: "google",
      rawResponse: { lat: -34.5, lng: -58.55 },
      lat: -34.5,
      lng: -58.55,
      accuracy: "INTERPOLATED",
    });

    const result = await geocodeAddress(rawText);
    expect(result).toMatchObject({
      lat: -34.5,
      lng: -58.55,
      accuracy: "INTERPOLATED",
      source: "cache",
    });

    await db.delete(geocodeCache).where(eq(geocodeCache.queryHash, hash));
  });

  it("sin GOOGLE_GEOCODING_API_KEY configurada, degrada a FAILED/not_configured", async () => {
    // No asumir que el entorno nunca tiene la key real cargada (FASE 6 la
    // agrega en local/producción para que el geocoding funcione de
    // verdad) — se apaga a propósito solo para este test y se restaura
    // después, así el camino "not_configured" queda probado siempre.
    const original = process.env.GOOGLE_GEOCODING_API_KEY;
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    try {
      const result = await geocodeAddress(
        `Dirección sin cachear ${runId}-${randomUUID()}`,
      );
      expect(result).toMatchObject({
        lat: null,
        lng: null,
        accuracy: "FAILED",
        source: "not_configured",
      });
    } finally {
      if (original !== undefined) process.env.GOOGLE_GEOCODING_API_KEY = original;
    }
  });
});

describe("geocodeOperationPackages (integración contra Supabase real)", () => {
  const runId = randomUUID().slice(0, 8);
  let orgId: string;
  let operationId: string;
  let userId: string;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: `GeoBatch Test Org ${runId}` })
      .returning();
    if (!org) throw new Error("no se pudo crear la org de test");
    orgId = org.id;

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: `geobatch-${runId}@test`,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("sin usuario");
    userId = data.user.id;
    await db.insert(users).values({
      id: userId,
      orgId,
      email: `geobatch-${runId}@test`,
      fullName: "Geo Batch",
    });
    await db.insert(userRoles).values({ userId, role: "warehouse" });

    const [op] = await db
      .insert(operations)
      .values({ orgId, operationDate: "2026-08-12", status: "OPEN" })
      .returning();
    if (!op) throw new Error("no se pudo crear la operación de test");
    operationId = op.id;
  }, 30_000);

  afterAll(async () => {
    await purgeTestEvents(orgId);
    await db.delete(packages).where(sql`org_id = ${orgId}`);
    await db.delete(knownAddresses).where(sql`org_id = ${orgId}`);
    await db.delete(operations).where(sql`org_id = ${orgId}`);
    await db.delete(userRoles).where(sql`user_id = ${userId}`);
    await db.delete(users).where(sql`org_id = ${orgId}`);
    await db.delete(organizations).where(sql`id = ${orgId}`);
    await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
  }, 30_000);

  it("geocodifica lo resoluble (known_address pre-existente) y deja el resto en RECIBIDO", async () => {
    // Igual que el test de arriba: el paquete "bad" tiene una dirección
    // sin sentido a propósito, para forzar el camino FAILED — con la key
    // real configurada, la API de Google es lo bastante permisiva como
    // para devolver *algo* igual, así que se apaga la key para que el
    // resultado sea determinístico. El paquete "good" no depende de la
    // key en ningún caso: resuelve por `known_addresses`, sembrado abajo.
    const originalKey = process.env.GOOGLE_GEOCODING_API_KEY;
    delete process.env.GOOGLE_GEOCODING_API_KEY;

    try {
      const goodAddress = `Belgrano 2210, San Martín ${runId}`;
      const hash = await hashNormalizedAddress(goodAddress);
      await db.insert(knownAddresses).values({
        orgId,
        normalizedHash: hash,
        rawText: goodAddress,
        lat: -34.57,
        lng: -58.53,
        geocodeAccuracy: "ROOFTOP",
      });

      const [good] = await db
        .insert(packages)
        .values({
          orgId,
          operationId,
          internalCode: `ML-GEO-GOOD-${runId}`,
          status: "RECIBIDO",
          rawAddressText: goodAddress,
        })
        .returning();
      const [bad] = await db
        .insert(packages)
        .values({
          orgId,
          operationId,
          internalCode: `ML-GEO-BAD-${runId}`,
          status: "RECIBIDO",
          rawAddressText: `Dirección sin geocodificar ${runId}`,
        })
        .returning();
      if (!good || !bad) throw new Error("no se pudieron crear los paquetes de test");

      const summary = await geocodeOperationPackages(orgId, operationId, {
        userId,
        roles: ["warehouse"],
      });

      expect(summary.processed).toBe(2);
      expect(summary.geocoded).toBe(1);
      expect(summary.failed).toBe(1);

      const [goodRow] = await db.select().from(packages).where(eq(packages.id, good.id));
      expect(goodRow?.status).toBe("GEOCODIFICADO");
      expect(goodRow?.addressId).toBeTruthy();

      const [badRow] = await db.select().from(packages).where(eq(packages.id, bad.id));
      expect(badRow?.status).toBe("RECIBIDO"); // no entra al ruteo, §16
    } finally {
      if (originalKey !== undefined) process.env.GOOGLE_GEOCODING_API_KEY = originalKey;
    }
  });
});
