/**
 * `getDriverCurrentRoute` — integración contra Supabase real. Arma un
 * escenario completo (paquetes → cluster → ruta → aprobar) reusando el
 * mismo camino que `route-planning.test.ts`, porque es la única forma
 * real de llegar a una ruta `APPROVED` con `assigned_driver_id` seteado.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
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
import { approveRoute, generateRouteProposal } from "../route-planning";
import { getDriverCurrentRoute } from "../driver";

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

describe("getDriverCurrentRoute (integración contra Supabase real)", () => {
  const runId = randomUUID().slice(0, 8);
  let orgId: string;
  let operationId: string;
  let driverId: string;
  let otherDriverId: string;
  let routeId: string;

  beforeAll(async () => {
    process.env.DEFAULT_DEPOT_LAT = "-34.56";
    process.env.DEFAULT_DEPOT_LNG = "-58.55";

    const [org] = await db
      .insert(organizations)
      .values({ name: `Driver Test Org ${runId}` })
      .returning();
    if (!org) throw new Error("no se pudo crear la org");
    orgId = org.id;

    const [op] = await db
      .insert(operations)
      .values({ orgId, operationDate: "2026-08-15", status: "OPEN" })
      .returning();
    if (!op) throw new Error("no se pudo crear la operación");
    operationId = op.id;

    const { data: d1, error: e1 } = await supabaseAdmin.auth.admin.createUser({
      email: `driver-test-${runId}@test`,
      password: "DriverTest123!",
      email_confirm: true,
    });
    if (e1 || !d1.user) throw e1 ?? new Error("sin usuario");
    driverId = d1.user.id;

    const { data: d2, error: e2 } = await supabaseAdmin.auth.admin.createUser({
      email: `driver-other-${runId}@test`,
      password: "DriverTest123!",
      email_confirm: true,
    });
    if (e2 || !d2.user) throw e2 ?? new Error("sin usuario");
    otherDriverId = d2.user.id;

    await db.insert(users).values([
      {
        id: driverId,
        orgId,
        email: `driver-test-${runId}@test`,
        fullName: "Driver Test",
      },
      {
        id: otherDriverId,
        orgId,
        email: `driver-other-${runId}@test`,
        fullName: "Other Driver",
      },
    ]);
    await db.insert(userRoles).values([
      { userId: driverId, role: "driver" },
      { userId: otherDriverId, role: "driver" },
    ]);

    await db.insert(vehicles).values({
      orgId,
      plate: `DRV-${runId}`,
      status: "AVAILABLE",
      assignedDriverId: driverId,
      capacityPackages: 10,
    });

    for (let i = 0; i < 3; i++) {
      const [addr] = await db
        .insert(knownAddresses)
        .values({
          orgId,
          normalizedHash: `driver-test-${runId}-${i}`,
          rawText: `Perú ${800 + i}, Villa Ballester`,
          lat: -34.5489 + i * 0.001,
          lng: -58.5645 + i * 0.001,
          geocodeAccuracy: "ROOFTOP",
          operationalNotes: i === 0 ? "Timbre no anda" : null,
        })
        .returning();
      if (!addr) throw new Error("no se pudo crear la dirección");
      await db.insert(packages).values({
        orgId,
        operationId,
        internalCode: `ML-DRV-${runId}-${i}`,
        trackingCode: `TC-DRV-${runId}-${i}`,
        status: "GEOCODIFICADO",
        addressId: addr.id,
        recipientName: `Destinatario ${i}`,
      });
    }

    const proposal = await generateRouteProposal(orgId, operationId);
    const [firstRoute] = proposal.routes;
    if (!firstRoute) throw new Error("no se generó ninguna ruta");
    routeId = firstRoute.routeId;

    await approveRoute(orgId, routeId, { userId: driverId, roles: ["admin"] });
  }, 60_000);

  afterAll(async () => {
    await purgeTestEvents(orgId);
    await db.delete(routeStops).where(eq(routeStops.routeId, routeId));
    await db.delete(packages).where(eq(packages.orgId, orgId));
    await db.delete(routes).where(eq(routes.orgId, orgId));
    await db.delete(knownAddresses).where(eq(knownAddresses.orgId, orgId));
    await db.delete(vehicles).where(eq(vehicles.orgId, orgId));
    await db.delete(operations).where(eq(operations.orgId, orgId));
    await db.delete(userRoles).where(eq(userRoles.userId, driverId));
    await db.delete(userRoles).where(eq(userRoles.userId, otherDriverId));
    await db.delete(users).where(eq(users.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await supabaseAdmin.auth.admin.deleteUser(driverId).catch(() => {});
    await supabaseAdmin.auth.admin.deleteUser(otherDriverId).catch(() => {});
  }, 30_000);

  it("devuelve la ruta APPROVED del chofer con sus paradas en secuencia y notas operativas", async () => {
    const result = await getDriverCurrentRoute(orgId, driverId);

    expect(result.route?.id).toBe(routeId);
    expect(result.route?.status).toBe("APPROVED");
    expect(result.stops.length).toBeGreaterThan(0);

    const sequences = result.stops.map((s) => s.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b)); // en orden

    expect(result.stops.every((s) => s.bulkNumber != null)).toBe(true); // ya congelado
    expect(result.stops.some((s) => s.operationalNotes === "Timbre no anda")).toBe(true);
  });

  it("un chofer sin ruta asignada no ve nada (nunca la ruta de otro)", async () => {
    const result = await getDriverCurrentRoute(orgId, otherDriverId);
    expect(result.route).toBeNull();
    expect(result.stops).toEqual([]);
  });
});
