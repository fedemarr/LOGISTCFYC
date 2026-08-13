/**
 * `generateRouteProposal` / `reassignPackageRoute` / `approveRoute` —
 * integración contra Supabase real, mismo patrón que
 * `services/__tests__/ingestion.test.ts`.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  knownAddresses,
  operations,
  organizations,
  packages,
  routes,
  routeStops,
  userRoles,
  users,
  vehicles,
} from "@/lib/db/schema";
import { purgeTestEvents } from "@/lib/db/test-helpers";
import {
  approveRoute,
  generateRouteProposal,
  reassignPackageRoute,
  resolveDepotLocation,
} from "../route-planning";

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
const TEST_PASSWORD = "RouteTest123!";

describe("resolveDepotLocation", () => {
  it("tira VALIDATION_ERROR si no hay depósito configurado (ni settings ni env)", async () => {
    const previousLat = process.env.DEFAULT_DEPOT_LAT;
    const previousLng = process.env.DEFAULT_DEPOT_LNG;
    process.env.DEFAULT_DEPOT_LAT = "";
    process.env.DEFAULT_DEPOT_LNG = "";
    try {
      const [org] = await db
        .insert(organizations)
        .values({ name: `Depot Test Org ${randomUUID().slice(0, 8)}` })
        .returning();
      if (!org) throw new Error("no se pudo crear la org");
      await expect(resolveDepotLocation(org.id)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      await db.delete(organizations).where(eq(organizations.id, org.id));
    } finally {
      process.env.DEFAULT_DEPOT_LAT = previousLat;
      process.env.DEFAULT_DEPOT_LNG = previousLng;
    }
  });
});

describe("ruteo end-to-end (integración contra Supabase real)", () => {
  const runId = randomUUID().slice(0, 8);
  const villaBallester = { lat: -34.5489, lng: -58.5645 };
  const sanMartin = { lat: -34.5755, lng: -58.5326 };

  let orgId: string;
  let operationId: string;
  let driver1Id: string;
  let driver2Id: string;

  beforeAll(async () => {
    process.env.DEFAULT_DEPOT_LAT = "-34.56";
    process.env.DEFAULT_DEPOT_LNG = "-58.55";

    const [org] = await db
      .insert(organizations)
      .values({ name: `Route Test Org ${runId}` })
      .returning();
    if (!org) throw new Error("no se pudo crear la org de test");
    orgId = org.id;

    const [op] = await db
      .insert(operations)
      .values({ orgId, operationDate: "2026-08-13", status: "OPEN" })
      .returning();
    if (!op) throw new Error("no se pudo crear la operación de test");
    operationId = op.id;

    const { data: d1, error: e1 } = await supabaseAdmin.auth.admin.createUser({
      email: `route-driver1-${runId}@test`,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (e1 || !d1.user) throw e1 ?? new Error("sin usuario driver1");
    driver1Id = d1.user.id;

    const { data: d2, error: e2 } = await supabaseAdmin.auth.admin.createUser({
      email: `route-driver2-${runId}@test`,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (e2 || !d2.user) throw e2 ?? new Error("sin usuario driver2");
    driver2Id = d2.user.id;

    await db.insert(users).values([
      {
        id: driver1Id,
        orgId,
        email: `route-driver1-${runId}@test`,
        fullName: "Driver Uno",
      },
      {
        id: driver2Id,
        orgId,
        email: `route-driver2-${runId}@test`,
        fullName: "Driver Dos",
      },
    ]);
    await db.insert(userRoles).values([
      { userId: driver1Id, role: "driver" },
      { userId: driver2Id, role: "driver" },
    ]);

    const [v1, v2] = await db
      .insert(vehicles)
      .values([
        {
          orgId,
          plate: `RT1-${runId}`,
          status: "AVAILABLE",
          assignedDriverId: driver1Id,
          capacityPackages: 10,
        },
        {
          orgId,
          plate: `RT2-${runId}`,
          status: "AVAILABLE",
          assignedDriverId: driver2Id,
          capacityPackages: 10,
        },
      ])
      .returning();
    if (!v1 || !v2) throw new Error("no se pudieron crear los vehículos de test");

    // 5 paquetes en Villa Ballester + 5 en San Martín, GEOCODIFICADO.
    for (const [zone, center] of [
      ["VB", villaBallester],
      ["SM", sanMartin],
    ] as const) {
      for (let i = 0; i < 5; i++) {
        const lat = center.lat + i * 0.001;
        const lng = center.lng + i * 0.001;
        const [addr] = await db
          .insert(knownAddresses)
          .values({
            orgId,
            normalizedHash: `route-test-${runId}-${zone}-${i}`,
            rawText: `Calle Falsa ${i}, ${zone}`,
            lat,
            lng,
            geocodeAccuracy: "ROOFTOP",
          })
          .returning();
        if (!addr) throw new Error("no se pudo crear la dirección de test");

        const [pkg] = await db
          .insert(packages)
          .values({
            orgId,
            operationId,
            internalCode: `ML-RT-${runId}-${zone}-${i}`,
            trackingCode: `TC-RT-${runId}-${zone}-${i}`,
            status: "GEOCODIFICADO",
            addressId: addr.id,
          })
          .returning();
        if (!pkg) throw new Error("no se pudo crear el paquete de test");
      }
    }
  }, 60_000);

  afterAll(async () => {
    await purgeTestEvents(orgId);
    await db
      .delete(routeStops)
      .where(sql`route_id IN (SELECT id FROM routes WHERE org_id = ${orgId})`);
    // `packages.route_id` referencia `routes` — hay que borrar los paquetes
    // (o al menos desvincularlos) antes de poder borrar las rutas.
    await db.delete(packages).where(eq(packages.orgId, orgId));
    await db.delete(routes).where(eq(routes.orgId, orgId));
    await db.delete(knownAddresses).where(eq(knownAddresses.orgId, orgId));
    await db.delete(vehicles).where(eq(vehicles.orgId, orgId));
    await db.delete(operations).where(eq(operations.orgId, orgId));
    await db.delete(userRoles).where(sql`user_id IN (${driver1Id}, ${driver2Id})`);
    await db.delete(users).where(eq(users.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await supabaseAdmin.auth.admin.deleteUser(driver1Id).catch(() => {});
    await supabaseAdmin.auth.admin.deleteUser(driver2Id).catch(() => {});
  }, 30_000);

  it("genera rutas balanceadas a partir de los paquetes GEOCODIFICADO de la operación", async () => {
    const result = await generateRouteProposal(orgId, operationId);

    expect(result.outlierPackageIds).toHaveLength(0);
    expect(result.routes.length).toBeGreaterThanOrEqual(1);
    const totalAssigned = result.routes.reduce((sum, r) => sum + r.packageCount, 0);
    expect(totalAssigned).toBe(10);

    for (const r of result.routes) {
      expect(r.plannedDistanceM).toBeGreaterThan(0);
      expect(r.plannedDurationS).toBeGreaterThan(0);
    }

    const dbRoutes = await db.select().from(routes).where(eq(routes.orgId, orgId));
    expect(dbRoutes.every((r) => r.status === "DRAFT")).toBe(true);
    expect(dbRoutes.every((r) => r.colorHex)).toBe(true);

    const assignedPackages = await db
      .select({ id: packages.id, routeId: packages.routeId })
      .from(packages)
      .where(eq(packages.orgId, orgId));
    expect(assignedPackages.every((p) => p.routeId != null)).toBe(true);
  }, 30_000);

  it("reasignar un paquete entre rutas actualiza ambas rutas (§8 etapa 3)", async () => {
    const dbRoutes = await db.select().from(routes).where(eq(routes.orgId, orgId));
    expect(dbRoutes.length).toBeGreaterThanOrEqual(1);
    if (dbRoutes.length < 2) return; // no hay dos rutas para probar el movimiento (capacidad/clustering)

    const [routeA, routeB] = dbRoutes;
    if (!routeA || !routeB) return;

    const [stopInA] = await db
      .select()
      .from(routeStops)
      .where(eq(routeStops.routeId, routeA.id))
      .limit(1);
    if (!stopInA) return;

    const beforeBCount = (
      await db.select().from(routeStops).where(eq(routeStops.routeId, routeB.id))
    ).length;

    await reassignPackageRoute(orgId, stopInA.packageId, routeB.id);

    const [movedPackage] = await db
      .select({ routeId: packages.routeId })
      .from(packages)
      .where(eq(packages.id, stopInA.packageId));
    expect(movedPackage?.routeId).toBe(routeB.id);

    const afterBCount = (
      await db.select().from(routeStops).where(eq(routeStops.routeId, routeB.id))
    ).length;
    expect(afterBCount).toBe(beforeBCount + 1);
  }, 30_000);

  it("aprobar una ruta congela bulk_number (1..n) y transiciona los paquetes a ASIGNADO", async () => {
    const [route] = await db
      .select()
      .from(routes)
      .where(eq(routes.orgId, orgId))
      .limit(1);
    if (!route) throw new Error("no hay rutas para aprobar");

    const result = await approveRoute(orgId, route.id, {
      userId: driver1Id,
      roles: ["admin"],
    });
    expect(result.status).toBe("APPROVED");

    const [updatedRoute] = await db.select().from(routes).where(eq(routes.id, route.id));
    expect(updatedRoute?.status).toBe("APPROVED");

    const assigned = await db
      .select({
        id: packages.id,
        bulkNumber: packages.bulkNumber,
        status: packages.status,
      })
      .from(packages)
      .where(eq(packages.routeId, route.id));
    expect(assigned.length).toBe(result.packageCount);
    const bulkNumbers = assigned
      .map((p) => p.bulkNumber)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(bulkNumbers).toEqual(Array.from({ length: assigned.length }, (_, i) => i + 1));
    expect(assigned.every((p) => p.status === "ASIGNADO")).toBe(true);
  }, 30_000);

  it("aprobar una ruta ya aprobada falla con CONFLICT", async () => {
    const [route] = await db
      .select()
      .from(routes)
      .where(sql`org_id = ${orgId} AND status = 'APPROVED'`)
      .limit(1);
    if (!route) throw new Error("no hay ruta aprobada para el caso negativo");

    await expect(
      approveRoute(orgId, route.id, { userId: driver1Id, roles: ["admin"] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reasignar un paquete de una ruta ya APPROVED falla con CONFLICT", async () => {
    const [approvedRoute] = await db
      .select()
      .from(routes)
      .where(sql`org_id = ${orgId} AND status = 'APPROVED'`)
      .limit(1);
    const [draftRoute] = await db
      .select()
      .from(routes)
      .where(sql`org_id = ${orgId} AND status != 'APPROVED'`)
      .limit(1);
    if (!approvedRoute || !draftRoute) return;

    const [stop] = await db
      .select()
      .from(routeStops)
      .where(eq(routeStops.routeId, approvedRoute.id))
      .limit(1);
    if (!stop) return;

    await expect(
      reassignPackageRoute(orgId, stop.packageId, draftRoute.id),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("agregar ruta (generateRouteProposal corrido más de una vez, §8)", () => {
  const runId = randomUUID().slice(0, 8);
  const villaBallester = { lat: -34.5489, lng: -58.5645 };
  const sanMartin = { lat: -34.5755, lng: -58.5326 };

  let orgId: string;
  let operationId: string;
  let driver1Id: string;
  let driver2Id: string;
  let vehicle1Id: string;

  async function makePackage(
    zone: string,
    i: number,
    center: { lat: number; lng: number },
  ) {
    const lat = center.lat + i * 0.001;
    const lng = center.lng + i * 0.001;
    const [addr] = await db
      .insert(knownAddresses)
      .values({
        orgId,
        normalizedHash: `route-add-${runId}-${zone}-${i}`,
        rawText: `Calle Agregar ${i}, ${zone}`,
        lat,
        lng,
        geocodeAccuracy: "ROOFTOP",
      })
      .returning();
    if (!addr) throw new Error("no se pudo crear la dirección de test");
    await db.insert(packages).values({
      orgId,
      operationId,
      internalCode: `ML-ADD-${runId}-${zone}-${i}`,
      trackingCode: `TC-ADD-${runId}-${zone}-${i}`,
      status: "GEOCODIFICADO",
      addressId: addr.id,
    });
  }

  beforeAll(async () => {
    process.env.DEFAULT_DEPOT_LAT = "-34.56";
    process.env.DEFAULT_DEPOT_LNG = "-58.55";

    const [org] = await db
      .insert(organizations)
      .values({ name: `Route Add Test Org ${runId}` })
      .returning();
    if (!org) throw new Error("no se pudo crear la org de test");
    orgId = org.id;

    const [op] = await db
      .insert(operations)
      .values({ orgId, operationDate: "2026-08-13", status: "OPEN" })
      .returning();
    if (!op) throw new Error("no se pudo crear la operación de test");
    operationId = op.id;

    const { data: d1, error: e1 } = await supabaseAdmin.auth.admin.createUser({
      email: `route-add-driver1-${runId}@test`,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (e1 || !d1.user) throw e1 ?? new Error("sin usuario driver1");
    driver1Id = d1.user.id;

    const { data: d2, error: e2 } = await supabaseAdmin.auth.admin.createUser({
      email: `route-add-driver2-${runId}@test`,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (e2 || !d2.user) throw e2 ?? new Error("sin usuario driver2");
    driver2Id = d2.user.id;

    await db.insert(users).values([
      {
        id: driver1Id,
        orgId,
        email: `route-add-driver1-${runId}@test`,
        fullName: "Driver Add Uno",
      },
      {
        id: driver2Id,
        orgId,
        email: `route-add-driver2-${runId}@test`,
        fullName: "Driver Add Dos",
      },
    ]);
    await db.insert(userRoles).values([
      { userId: driver1Id, role: "driver" },
      { userId: driver2Id, role: "driver" },
    ]);

    const [v1] = await db
      .insert(vehicles)
      .values({
        orgId,
        plate: `ADD1-${runId}`,
        status: "AVAILABLE",
        assignedDriverId: driver1Id,
        capacityPackages: 10,
      })
      .returning();
    if (!v1) throw new Error("no se pudo crear el vehículo 1 de test");
    vehicle1Id = v1.id;

    // Primera tanda: 3 paquetes en Villa Ballester.
    for (let i = 0; i < 3; i++) await makePackage("VB", i, villaBallester);
  }, 60_000);

  afterAll(async () => {
    await purgeTestEvents(orgId);
    await db
      .delete(routeStops)
      .where(sql`route_id IN (SELECT id FROM routes WHERE org_id = ${orgId})`);
    await db.delete(packages).where(eq(packages.orgId, orgId));
    await db.delete(routes).where(eq(routes.orgId, orgId));
    await db.delete(knownAddresses).where(eq(knownAddresses.orgId, orgId));
    await db.delete(vehicles).where(eq(vehicles.orgId, orgId));
    await db.delete(operations).where(eq(operations.orgId, orgId));
    await db.delete(userRoles).where(sql`user_id IN (${driver1Id}, ${driver2Id})`);
    await db.delete(users).where(eq(users.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await supabaseAdmin.auth.admin.deleteUser(driver1Id).catch(() => {});
    await supabaseAdmin.auth.admin.deleteUser(driver2Id).catch(() => {});
  }, 30_000);

  it("primera corrida rutea los 3 paquetes con RUTA 001 usando el único vehículo libre", async () => {
    const result = await generateRouteProposal(orgId, operationId);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.routeNumber).toBe(1);
    expect(result.routes[0]?.packageCount).toBe(3);
  }, 30_000);

  it("sin vehículo libre nuevo, correrla de nuevo con 0 paquetes libres falla VALIDATION_ERROR", async () => {
    // Los 3 paquetes ya están en RUTA 001 (routeId seteado) — no queda
    // nada libre para rutear todavía.
    await expect(generateRouteProposal(orgId, operationId)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("agregar ruta: paquetes nuevos + segundo vehículo generan RUTA 002 sin tocar RUTA 001", async () => {
    for (let i = 0; i < 2; i++) await makePackage("SM", i, sanMartin);
    const [v2] = await db
      .insert(vehicles)
      .values({
        orgId,
        plate: `ADD2-${runId}`,
        status: "AVAILABLE",
        assignedDriverId: driver2Id,
        capacityPackages: 10,
      })
      .returning();
    if (!v2) throw new Error("no se pudo crear el vehículo 2 de test");

    const result = await generateRouteProposal(orgId, operationId);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.routeNumber).toBe(2); // sigue la numeración, no reinicia en 1
    expect(result.routes[0]?.packageCount).toBe(2);

    const dbRoutes = await db
      .select()
      .from(routes)
      .where(eq(routes.orgId, orgId))
      .orderBy(routes.routeNumber);
    expect(dbRoutes).toHaveLength(2);
    expect(dbRoutes[0]?.vehicleId).toBe(vehicle1Id); // RUTA 001 sin cambios
    expect(dbRoutes[1]?.vehicleId).toBe(v2.id); // RUTA 002 usa el vehículo nuevo, no el ocupado

    const stopsRoute1 = await db
      .select()
      .from(routeStops)
      .where(eq(routeStops.routeId, dbRoutes[0]!.id));
    expect(stopsRoute1).toHaveLength(3); // intacta
  }, 30_000);
});
