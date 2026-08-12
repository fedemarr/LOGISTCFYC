/**
 * `generateRouteLabelsPdf` — integración contra Supabase real. Solo se
 * verifica que el PDF sea válido y que respete la regla de negocio
 * (§9.2: no imprimir bulk_number sin congelar, es decir, ruta no APPROVED).
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
import { generateRouteLabelsPdf } from "../labels";

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

describe("generateRouteLabelsPdf (integración contra Supabase real)", () => {
  const runId = randomUUID().slice(0, 8);
  let orgId: string;
  let operationId: string;
  let driverId: string;
  let routeId: string;

  beforeAll(async () => {
    process.env.DEFAULT_DEPOT_LAT = "-34.56";
    process.env.DEFAULT_DEPOT_LNG = "-58.55";

    const [org] = await db
      .insert(organizations)
      .values({ name: `Labels Test Org ${runId}` })
      .returning();
    if (!org) throw new Error("no se pudo crear la org");
    orgId = org.id;

    const [op] = await db
      .insert(operations)
      .values({ orgId, operationDate: "2026-08-14", status: "OPEN" })
      .returning();
    if (!op) throw new Error("no se pudo crear la operación");
    operationId = op.id;

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: `labels-driver-${runId}@test`,
      password: "LabelsTest123!",
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("sin usuario");
    driverId = data.user.id;

    await db.insert(users).values({
      id: driverId,
      orgId,
      email: `labels-driver-${runId}@test`,
      fullName: "Labels Driver",
    });
    await db.insert(userRoles).values({ userId: driverId, role: "driver" });

    await db.insert(vehicles).values({
      orgId,
      plate: `LB-${runId}`,
      status: "AVAILABLE",
      assignedDriverId: driverId,
      capacityPackages: 10,
    });

    for (let i = 0; i < 3; i++) {
      const [addr] = await db
        .insert(knownAddresses)
        .values({
          orgId,
          normalizedHash: `labels-test-${runId}-${i}`,
          rawText: `Perú ${800 + i}, Villa Ballester`,
          lat: -34.5489 + i * 0.001,
          lng: -58.5645 + i * 0.001,
          geocodeAccuracy: "ROOFTOP",
        })
        .returning();
      if (!addr) throw new Error("no se pudo crear la dirección");
      await db.insert(packages).values({
        orgId,
        operationId,
        internalCode: `ML-LB-${runId}-${i}`,
        trackingCode: `TC-LB-${runId}-${i}`,
        status: "GEOCODIFICADO",
        addressId: addr.id,
        recipientName: `Destinatario ${i}`,
      });
    }

    const proposal = await generateRouteProposal(orgId, operationId);
    const [firstRoute] = proposal.routes;
    if (!firstRoute) throw new Error("no se generó ninguna ruta");
    routeId = firstRoute.routeId;
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
    await db.delete(users).where(eq(users.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await supabaseAdmin.auth.admin.deleteUser(driverId).catch(() => {});
  }, 30_000);

  it("rechaza imprimir etiquetas de una ruta que todavía no está APPROVED", async () => {
    await expect(generateRouteLabelsPdf(orgId, routeId, "thermal")).rejects.toMatchObject(
      {
        code: "VALIDATION_ERROR",
      },
    );
  });

  it("genera un PDF térmico válido (una página por bulto) tras aprobar", async () => {
    await approveRoute(orgId, routeId, { userId: driverId, roles: ["admin"] });

    const pdfBytes = await generateRouteLabelsPdf(orgId, routeId, "thermal");
    expect(pdfBytes.length).toBeGreaterThan(0);
    const header = Buffer.from(pdfBytes.slice(0, 5)).toString("utf-8");
    expect(header).toBe("%PDF-");
  });

  it("genera también el formato A4 (grilla 2×2)", async () => {
    const pdfBytes = await generateRouteLabelsPdf(orgId, routeId, "a4");
    expect(pdfBytes.length).toBeGreaterThan(0);
    const header = Buffer.from(pdfBytes.slice(0, 5)).toString("utf-8");
    expect(header).toBe("%PDF-");
  });
});
