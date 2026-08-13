/**
 * Custodia y carga (§9.3-§9.4, FASE 9) — integración contra Supabase real.
 * Cada test arma su propio escenario (org + operación + vehículo + chofer +
 * contenedor + ruta APPROVED) reusando el camino real de
 * `route-planning.test.ts`, porque es la única forma de llegar a una ruta
 * `APPROVED` con `assigned_driver_id`, `container_id` y `bulk_number`
 * seteado de verdad.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  containers,
  custodyTransfers,
  knownAddresses,
  operations,
  organizations,
  packages,
  packageScans,
  routes,
  routeStops,
  userRoles,
  users,
  vehicles,
} from "@/lib/db/schema";
import { purgeTestEvents } from "@/lib/db/test-helpers";
import { approveRoute, generateRouteProposal } from "../route-planning";
import {
  assignRouteContainer,
  finishFullScan,
  getDriverCustodyState,
  overrideCustody,
  scanPackageForCustody,
  startCustody,
  startRoute,
  submitCustodyCount,
} from "../custody";

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
const TEST_PASSWORD = "CustodyTest123!";

interface Scenario {
  orgId: string;
  operationId: string;
  driverId: string;
  adminId: string;
  routeId: string;
  containerId: string;
  vehicleId: string;
  expectedCount: number;
  internalCodes: string[];
  packageIds: string[];
}

describe("custodia y carga (integración contra Supabase real)", () => {
  const runId = randomUUID().slice(0, 8);
  let current: Scenario | null = null;

  beforeAll(() => {
    process.env.DEFAULT_DEPOT_LAT = "-34.56";
    process.env.DEFAULT_DEPOT_LNG = "-58.55";
  });

  afterEach(async () => {
    const s = current;
    current = null;
    if (!s) return;

    // Algunos tests crean rutas/usuarios EXTRA aparte de los de `s` (ej. el
    // chequeo cruzado de custodia, que arma una segunda ruta de otro
    // chofer) — limpiar solo `s.routeId`/`s.driverId`/`s.adminId` deja
    // huérfanos que bloquean los deletes de abajo por FK. Se resuelve todo
    // por `orgId` en vez de por los ids puntuales del escenario principal.
    const orgRoutes = await db
      .select({ id: routes.id })
      .from(routes)
      .where(eq(routes.orgId, s.orgId));
    const orgRouteIds = orgRoutes.map((r) => r.id);
    const orgUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.orgId, s.orgId));
    const orgUserIds = orgUsers.map((u) => u.id);

    await purgeTestEvents(s.orgId);
    await db.delete(packageScans).where(eq(packageScans.orgId, s.orgId));
    await db.delete(custodyTransfers).where(eq(custodyTransfers.orgId, s.orgId));
    if (orgRouteIds.length > 0) {
      await db.delete(routeStops).where(inArray(routeStops.routeId, orgRouteIds));
    }
    await db.delete(packages).where(eq(packages.orgId, s.orgId));
    await db.delete(routes).where(eq(routes.orgId, s.orgId));
    await db.delete(knownAddresses).where(eq(knownAddresses.orgId, s.orgId));
    await db.delete(containers).where(eq(containers.orgId, s.orgId));
    await db.delete(vehicles).where(eq(vehicles.orgId, s.orgId));
    await db.delete(operations).where(eq(operations.orgId, s.orgId));
    if (orgUserIds.length > 0) {
      await db.delete(userRoles).where(inArray(userRoles.userId, orgUserIds));
    }
    await db.delete(users).where(eq(users.orgId, s.orgId));
    await db.delete(organizations).where(eq(organizations.id, s.orgId));
    for (const userId of orgUserIds) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
    }
  }, 30_000);

  async function createScenario(label: string, packageCount: number): Promise<Scenario> {
    const id = `${runId}-${label}`;

    const [org] = await db
      .insert(organizations)
      .values({ name: `Custody Test Org ${id}` })
      .returning();
    if (!org) throw new Error("no se pudo crear la org");
    const orgId = org.id;

    const [op] = await db
      .insert(operations)
      .values({ orgId, operationDate: "2026-08-17", status: "OPEN" })
      .returning();
    if (!op) throw new Error("no se pudo crear la operación");
    const operationId = op.id;

    const { data: driver, error: e1 } = await supabaseAdmin.auth.admin.createUser({
      email: `custody-driver-${id}@test`,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (e1 || !driver.user) throw e1 ?? new Error("sin usuario chofer");
    const driverId = driver.user.id;

    const { data: admin, error: e2 } = await supabaseAdmin.auth.admin.createUser({
      email: `custody-admin-${id}@test`,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (e2 || !admin.user) throw e2 ?? new Error("sin usuario admin");
    const adminId = admin.user.id;

    await db.insert(users).values([
      {
        id: driverId,
        orgId,
        email: `custody-driver-${id}@test`,
        fullName: "Chofer Test",
      },
      { id: adminId, orgId, email: `custody-admin-${id}@test`, fullName: "Admin Test" },
    ]);
    await db.insert(userRoles).values([
      { userId: driverId, role: "driver" },
      { userId: adminId, role: "admin" },
    ]);

    const [vehicle] = await db
      .insert(vehicles)
      .values({
        orgId,
        // No usar `id.slice(0, 6)`: `id` es `${runId}-${label}` y `runId`
        // solo mide 8 caracteres, así que ese slice devolvía siempre el
        // mismo prefijo (el de `runId`) sin importar `label` — todos los
        // escenarios de la misma corrida generaban la MISMA patente,
        // chocando contra `vehicles_plate_unique` en cuanto el cleanup de
        // un test anterior se demoraba o fallaba un paso.
        plate: `CUS-${randomUUID().slice(0, 6).toUpperCase()}`,
        status: "AVAILABLE",
        assignedDriverId: driverId,
        capacityPackages: 10,
      })
      .returning();
    if (!vehicle) throw new Error("no se pudo crear el vehículo");

    for (let i = 0; i < packageCount; i++) {
      const [addr] = await db
        .insert(knownAddresses)
        .values({
          orgId,
          normalizedHash: `custody-${id}-${i}`,
          rawText: `Av. Test ${800 + i}, Villa Ballester`,
          lat: -34.5489 + i * 0.001,
          lng: -58.5645 + i * 0.001,
          geocodeAccuracy: "ROOFTOP",
        })
        .returning();
      if (!addr) throw new Error("no se pudo crear la dirección");
      await db.insert(packages).values({
        orgId,
        operationId,
        internalCode: `ML-CUS-${id}-${i}`,
        trackingCode: `TC-CUS-${id}-${i}`,
        status: "GEOCODIFICADO",
        addressId: addr.id,
        recipientName: `Destinatario ${i}`,
      });
    }

    const proposal = await generateRouteProposal(orgId, operationId);
    const [firstRoute] = proposal.routes;
    if (!firstRoute) throw new Error("no se generó ninguna ruta");
    const routeId = firstRoute.routeId;

    await approveRoute(orgId, routeId, { userId: adminId, roles: ["admin"] });

    const [container] = await db
      .insert(containers)
      .values({
        orgId,
        code: `CONT-${id.toUpperCase()}`,
        qrPayload: `FYC-CONT-${id.toUpperCase()}`,
        type: "CART",
      })
      .returning();
    if (!container) throw new Error("no se pudo crear el contenedor");

    await assignRouteContainer(
      orgId,
      routeId,
      { userId: adminId, roles: ["admin"] },
      container.id,
    );

    const routePackages = await db
      .select({ id: packages.id, internalCode: packages.internalCode })
      .from(packages)
      .where(eq(packages.routeId, routeId))
      .orderBy(packages.bulkNumber);

    current = {
      orgId,
      operationId,
      driverId,
      adminId,
      routeId,
      containerId: container.id,
      vehicleId: vehicle.id,
      expectedCount: routePackages.length,
      internalCodes: routePackages.map((p) => p.internalCode),
      packageIds: routePackages.map((p) => p.id),
    };
    return current;
  }

  async function approvedAndCustodied(
    label: string,
    packageCount: number,
  ): Promise<Scenario> {
    const s = await createScenario(label, packageCount);
    await startCustody(s.orgId, s.driverId, {
      containerCode: `FYC-CONT-${runId}-${label}`.toUpperCase(),
    });
    return s;
  }

  it("abre el acta al escanear el contenedor asignado (idempotente)", async () => {
    const s = await createScenario("scan", 3);

    const first = await startCustody(s.orgId, s.driverId, {
      containerCode: `FYC-CONT-${runId}-scan`.toUpperCase(),
      lat: -34.55,
      lng: -58.56,
    });

    expect(first.custody?.expectedCount).toBe(3);
    expect(first.custody?.countedCount).toBeNull();
    expect(first.custody?.method).toBe("COUNT");
    expect(first.route?.status).toBe("APPROVED");
    expect(first.container?.id).toBe(s.containerId);
    expect(first.canStart).toBe(false);

    const again = await startCustody(s.orgId, s.driverId, {
      containerCode: `FYC-CONT-${runId}-scan`.toUpperCase(),
    });
    expect(again.custody?.id).toBe(first.custody?.id);

    const [acta] = await db
      .select({ n: routes.routeNumber })
      .from(custodyTransfers)
      .innerJoin(routes, eq(routes.id, custodyTransfers.routeId))
      .where(eq(custodyTransfers.routeId, s.routeId));
    expect(acta).toBeTruthy();
  });

  it("rechaza un contenedor que no es el asignado y una ruta sin contenedor", async () => {
    const s = await createScenario("wrong", 3);

    const [otherContainer] = await db
      .insert(containers)
      .values({
        orgId: s.orgId,
        code: `CONT-OTHER-${runId}`,
        qrPayload: `FYC-CONT-OTHER-${runId}`,
        type: "BAG",
      })
      .returning();
    if (!otherContainer) throw new Error("no se pudo crear el contenedor extra");

    await expect(
      startCustody(s.orgId, s.driverId, { containerCode: `FYC-CONT-OTHER-${runId}` }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await db.update(routes).set({ containerId: null }).where(eq(routes.id, s.routeId));
    await expect(
      startCustody(s.orgId, s.driverId, {
        containerCode: `FYC-CONT-${runId}-wrong`.toUpperCase(),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("conteo correcto → custodia OK, ruta APPROVED→ASSIGNED, paquetes CARGADO", async () => {
    const s = await approvedAndCustodied("ok", 4);

    const state = await submitCustodyCount(s.orgId, s.driverId, {
      routeId: s.routeId,
      countedCount: 4,
    });

    expect(state.custody?.status).toBe("OK");
    expect(state.custody?.countedCount).toBe(4);
    expect(state.canStart).toBe(true);

    const [route] = await db.select().from(routes).where(eq(routes.id, s.routeId));
    expect(route?.status).toBe("ASSIGNED");

    const statuses = await db
      .select({ status: packages.status })
      .from(packages)
      .where(eq(packages.routeId, s.routeId));
    expect(statuses.every((p) => p.status === "CARGADO")).toBe(true);
  });

  it("conteo incorrecto → DISCREPANCY, la ruta NO arranca y los paquetes siguen ASIGNADO", async () => {
    const s = await approvedAndCustodied("mismatch", 4);

    const state = await submitCustodyCount(s.orgId, s.driverId, {
      routeId: s.routeId,
      countedCount: 3,
    });

    expect(state.custody?.status).toBe("DISCREPANCY");
    expect(state.custody?.discrepancyNotes).toContain("3");
    expect(state.canStart).toBe(false);

    const [route] = await db.select().from(routes).where(eq(routes.id, s.routeId));
    expect(route?.status).toBe("APPROVED");

    await expect(
      startRoute(s.orgId, s.driverId, {
        routeId: s.routeId,
        gpsAccuracyM: 10,
        batteryOptimizationDisabled: true,
        locationPermissionGranted: true,
        routeDownloaded: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const statuses = await db
      .select({ status: packages.status })
      .from(packages)
      .where(eq(packages.routeId, s.routeId));
    expect(statuses.every((p) => p.status === "ASIGNADO")).toBe(true);
  });

  it("full scan completo resuelve la diferencia → RESOLVED y custodia confirmada", async () => {
    const s = await approvedAndCustodied("fullscan", 4);
    await submitCustodyCount(s.orgId, s.driverId, {
      routeId: s.routeId,
      countedCount: 3,
    });

    for (const code of s.internalCodes) {
      const scan = await scanPackageForCustody(s.orgId, s.driverId, {
        routeId: s.routeId,
        rawCode: code,
      });
      expect(scan.match).toBe("matched");
    }

    const finish = await finishFullScan(s.orgId, s.driverId, { routeId: s.routeId });
    expect(finish.status).toBe("RESOLVED");
    expect(finish.missing).toEqual([]);
    expect(finish.extra).toEqual([]);

    const [route] = await db.select().from(routes).where(eq(routes.id, s.routeId));
    expect(route?.status).toBe("ASSIGNED");
    const statuses = await db
      .select({ status: packages.status })
      .from(packages)
      .where(eq(packages.routeId, s.routeId));
    expect(statuses.every((p) => p.status === "CARGADO")).toBe(true);
  });

  it("full scan con faltante → sigue DISCREPANCY con la lista", async () => {
    const s = await approvedAndCustodied("missing", 4);
    await submitCustodyCount(s.orgId, s.driverId, {
      routeId: s.routeId,
      countedCount: 3,
    });

    for (const code of s.internalCodes.slice(1)) {
      await scanPackageForCustody(s.orgId, s.driverId, {
        routeId: s.routeId,
        rawCode: code,
      });
    }

    const finish = await finishFullScan(s.orgId, s.driverId, { routeId: s.routeId });
    expect(finish.status).toBe("DISCREPANCY");
    expect(finish.missing.map((m) => m.internalCode)).toEqual([s.internalCodes[0]]);
    expect(finish.extra).toEqual([]);

    const [route] = await db.select().from(routes).where(eq(routes.id, s.routeId));
    expect(route?.status).toBe("APPROVED");
  });

  it("chequeo cruzado: un bulto de otra ruta activa se reporta como wrong_route", async () => {
    const s = await createScenario("cross", 3);
    await startCustody(s.orgId, s.driverId, {
      containerCode: `FYC-CONT-${runId}-cross`.toUpperCase(),
    });
    await submitCustodyCount(s.orgId, s.driverId, {
      routeId: s.routeId,
      countedCount: 2,
    });

    // Otra ruta APPROVED en la MISMA operación, con un paquete propio.
    // El usuario tiene que existir de verdad en Supabase Auth primero —
    // `users.id` tiene FK a `auth.users(id)`, un UUID inventado viola esa
    // constraint (mismo patrón que `driver`/`admin` de `createScenario`).
    const { data: otherAuth, error: otherAuthError } =
      await supabaseAdmin.auth.admin.createUser({
        email: `custody-cross-driver-${runId}@test`,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
    if (otherAuthError || !otherAuth.user) {
      throw otherAuthError ?? new Error("sin usuario para el otro chofer");
    }
    const [otherDriver] = await db
      .insert(users)
      .values({
        id: otherAuth.user.id,
        orgId: s.orgId,
        email: `custody-cross-driver-${runId}@test`,
        fullName: "Otro Chofer",
      })
      .returning();
    if (!otherDriver) throw new Error("no se pudo crear el otro chofer");
    await db.insert(userRoles).values({ userId: otherDriver.id, role: "driver" });

    const [otherVehicle] = await db
      .insert(vehicles)
      .values({
        orgId: s.orgId,
        plate: `CUS-CR-${runId}`,
        status: "AVAILABLE",
        assignedDriverId: otherDriver.id,
        capacityPackages: 10,
      })
      .returning();
    if (!otherVehicle) throw new Error("no se pudo crear el otro vehículo");

    const [otherAddr] = await db
      .insert(knownAddresses)
      .values({
        orgId: s.orgId,
        normalizedHash: `custody-cross-addr-${runId}`,
        rawText: "Av. Otra Ruta 1, Villa Ballester",
        lat: -34.55,
        lng: -58.56,
        geocodeAccuracy: "ROOFTOP",
      })
      .returning();
    if (!otherAddr) throw new Error("no se pudo crear la otra dirección");

    const crossCode = `ML-CROSS-${runId}`;
    const [otherPkg] = await db
      .insert(packages)
      .values({
        orgId: s.orgId,
        operationId: s.operationId,
        internalCode: crossCode,
        trackingCode: `TC-CROSS-${runId}`,
        status: "ASIGNADO",
        addressId: otherAddr.id,
        recipientName: "De la otra ruta",
      })
      .returning();
    if (!otherPkg) throw new Error("no se pudo crear el paquete cruzado");

    const [otherRoute] = await db
      .insert(routes)
      .values({
        orgId: s.orgId,
        operationId: s.operationId,
        routeNumber: 99,
        status: "APPROVED",
        assignedDriverId: otherDriver.id,
        vehicleId: otherVehicle.id,
        plannedStops: 1,
        colorHex: "#000000",
      })
      .returning();
    if (!otherRoute) throw new Error("no se pudo crear la otra ruta");

    await db.insert(routeStops).values({
      routeId: otherRoute.id,
      packageId: otherPkg.id,
      sequence: 0,
      status: "PENDING",
    });
    await db
      .update(packages)
      .set({ routeId: otherRoute.id, bulkNumber: 1 })
      .where(eq(packages.id, otherPkg.id));

    // `afterEach` limpia todo lo que cuelga de `s.orgId` (rutas/paquetes
    // extra, `otherDriver` en `users` y en Supabase Auth) — no hace falta
    // limpieza en línea acá.
    const scan = await scanPackageForCustody(s.orgId, s.driverId, {
      routeId: s.routeId,
      rawCode: crossCode,
    });

    expect(scan.match).toBe("wrong_route");
    expect(scan.otherRouteNumber).toBe(99);
  });

  it("override del dispatcher con motivo habilita el arranque", async () => {
    const s = await approvedAndCustodied("override", 4);
    await submitCustodyCount(s.orgId, s.driverId, {
      routeId: s.routeId,
      countedCount: 3,
    });

    // Sin motivo → falla; con motivo → OVERRIDDEN.
    await expect(
      overrideCustody(s.orgId, s.routeId, { userId: s.adminId, roles: ["admin"] }, "  "),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const state = await overrideCustody(
      s.orgId,
      s.routeId,
      { userId: s.adminId, roles: ["admin"] },
      "el cliente confirmó que falta un bulto y no lo reclama",
    );
    expect(state.custody?.status).toBe("OVERRIDDEN");
    expect(state.custody?.overrideReason).toContain("cliente");
    expect(state.canStart).toBe(true);

    const result = await startRoute(s.orgId, s.driverId, {
      routeId: s.routeId,
      gpsAccuracyM: 12,
      batteryLevel: 0.9,
      batteryOptimizationDisabled: true,
      locationPermissionGranted: true,
      routeDownloaded: true,
    });
    expect(result.status).toBe("IN_TRANSIT");
  });

  it("startRoute valida el checklist §9.4 en el servidor", async () => {
    const s = await approvedAndCustodied("checklist", 3);
    await submitCustodyCount(s.orgId, s.driverId, {
      routeId: s.routeId,
      countedCount: 3,
    });

    await expect(
      startRoute(s.orgId, s.driverId, {
        routeId: s.routeId,
        gpsAccuracyM: 10,
        batteryOptimizationDisabled: true,
        locationPermissionGranted: false,
        routeDownloaded: true,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      startRoute(s.orgId, s.driverId, {
        routeId: s.routeId,
        gpsAccuracyM: 120,
        batteryOptimizationDisabled: true,
        locationPermissionGranted: true,
        routeDownloaded: true,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      startRoute(s.orgId, s.driverId, {
        routeId: s.routeId,
        gpsAccuracyM: 10,
        batteryOptimizationDisabled: false,
        locationPermissionGranted: true,
        routeDownloaded: true,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      startRoute(s.orgId, s.driverId, {
        routeId: s.routeId,
        gpsAccuracyM: 10,
        batteryOptimizationDisabled: true,
        locationPermissionGranted: true,
        routeDownloaded: false,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await db
      .update(vehicles)
      .set({ status: "MAINTENANCE" })
      .where(eq(vehicles.id, s.vehicleId));
    await expect(
      startRoute(s.orgId, s.driverId, {
        routeId: s.routeId,
        gpsAccuracyM: 10,
        batteryOptimizationDisabled: true,
        locationPermissionGranted: true,
        routeDownloaded: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await db
      .update(vehicles)
      .set({ status: "AVAILABLE" })
      .where(eq(vehicles.id, s.vehicleId));

    const result = await startRoute(s.orgId, s.driverId, {
      routeId: s.routeId,
      gpsAccuracyM: 10,
      batteryLevel: 0.1,
      batteryOptimizationDisabled: true,
      locationPermissionGranted: true,
      routeDownloaded: true,
    });
    expect(result.status).toBe("IN_TRANSIT");
    expect(result.warnings.batteryLow).toBe(true);

    const [route] = await db.select().from(routes).where(eq(routes.id, s.routeId));
    expect(route?.status).toBe("IN_TRANSIT");
    expect(route?.startedAt).not.toBeNull();
    const statuses = await db
      .select({ status: packages.status })
      .from(packages)
      .where(eq(packages.routeId, s.routeId));
    expect(statuses.every((p) => p.status === "EN_REPARTO")).toBe(true);
    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, s.vehicleId));
    expect(vehicle?.status).toBe("IN_ROUTE");
  });

  it("getDriverCustodyState refleja el paso actual del flujo", async () => {
    const s = await approvedAndCustodied("state", 3);

    const before = await getDriverCustodyState(s.orgId, s.driverId);
    expect(before.custody?.countedCount).toBeNull();
    expect(before.canStart).toBe(false);

    await submitCustodyCount(s.orgId, s.driverId, {
      routeId: s.routeId,
      countedCount: 3,
    });

    const after = await getDriverCustodyState(s.orgId, s.driverId);
    expect(after.custody?.status).toBe("OK");
    expect(after.canStart).toBe(true);
    expect(after.scannedCount).toBe(0);
  });
});
