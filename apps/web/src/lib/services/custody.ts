/**
 * CUSTODIA Y CARGA — PROMPT-MAESTRO §9.3-§9.4 (FASE 9).
 *
 * El flujo completo que convierte una ruta `APPROVED` (bultos impresos,
 * contenedor asignado por el depósito) en una ruta en la calle:
 *
 *   1. `startCustody`        — el chofer escanea el QR/código del CONTENEDOR
 *                              asignado a su ruta → se abre el acta
 *                              (`custody_transfers`, método COUNT, sin conteo
 *                              todavía). Esperado = cantidad de paradas de la
 *                              ruta (bultos físicos).
 *   2. `submitCustodyCount`  — el chofer cuenta los bultos de verdad.
 *                              - Coincide  → acta `OK` y custodia confirmada.
 *                              - No coincide → acta `DISCREPANCY`: la ruta NO
 *                                puede iniciar hasta resolver el faltante/sobrante.
 *   3. `scanPackageForCustody` — escaneo individual (método FULL_SCAN) que el
 *                              chofer hace ante una diferencia: bulto por bulto,
 *                              con chequeo cruzado (§9.3): si un código no es de
 *                              esta ruta, se busca en las demás rutas activas de
 *                              la operación y se reporta "bulto no encontrado".
 *   4. `finishFullScan`      — cierra el escaneo individual: si no quedan
 *                              faltantes ni sobrantes → `RESOLVED` y custodia
 *                              confirmada; si queda algo → sigue `DISCREPANCY`
 *                              con la lista (el dispatcher la resuelve).
 *   5. `overrideCustody`     — el dispatcher acepta la diferencia con motivo
 *                              obligatorio → acta `OVERRIDDEN` (auditado).
 *   6. `startRoute`          — checklist §9.4 + transición ASSIGNED → IN_TRANSIT
 *                              (paquetes CARGADO → EN_REPARTO, vehículo IN_ROUTE).
 *
 * "Confirmar custodia" (= acta OK/RESOLVED/OVERRIDDEN) dispara la transición
 * real de ruta `APPROVED → ASSIGNED` y de cada paquete `ASIGNADO → CARGADO` —
 * la que hasta FASE 9 no existía en el código (ver `driver.ts`).
 *
 * Modelo del acta (decisión documentada, ver docs/DECISIONES.md FASE 9):
 * el `status` del enum `custody_status` solo significa algo una vez cargado
 * el `countedCount`; una fila con `counted_count IS NULL` es un acta abierta
 * sin conteo (el enum no tiene PENDING a propósito, se evita una migración).
 */
import { and, count, desc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import { detectCodeFormat, type CodeFormat, type Role } from "@fyc/shared";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import {
  containers,
  custodyTransfers,
  packages,
  packageScans,
  routes,
  routeStops,
  vehicles,
} from "@/lib/db/schema";
import { ACTIVE_ROUTE_STATUSES } from "./driver";
import { logDomainEvent } from "./events";
import { runPackageTransition } from "./state-machine";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type RouteStatus = typeof routes.$inferSelect.status;

/** Estados del chofer antes de tomar custodia — solo una ruta APPROVED se custodia. */
const CUSTODY_PENDING_ROUTE_STATUSES = [
  "APPROVED",
] as const satisfies readonly RouteStatus[];

/** Estados en los que el chofer sigue escaneando bultos (acta en DISCREPANCY). */
const CUSTODY_SCAN_ROUTE_STATUSES = [
  "APPROVED",
  "ASSIGNED",
] as const satisfies readonly RouteStatus[];

const CUSTODY_OK_STATUSES = ["OK", "RESOLVED", "OVERRIDDEN"] as const;

const TRANSITIONS_ROUTE: Record<string, readonly string[]> = {
  DRAFT: ["PROPOSED", "CANCELLED"],
  PROPOSED: ["APPROVED", "DRAFT", "CANCELLED"],
  APPROVED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["IN_TRANSIT", "CANCELLED"],
  LOADING: ["LOADED", "CANCELLED"],
  LOADED: ["IN_TRANSIT"],
  IN_TRANSIT: ["COMPLETED"],
};

const TRANSITIONS_VEHICLE: Record<string, readonly string[]> = {
  AVAILABLE: ["IN_ROUTE", "MAINTENANCE", "OUT_OF_SERVICE"],
  IN_ROUTE: ["AVAILABLE", "MAINTENANCE", "OUT_OF_SERVICE"],
  MAINTENANCE: ["AVAILABLE", "OUT_OF_SERVICE"],
  OUT_OF_SERVICE: ["AVAILABLE"],
};

function assertTransition<T extends string>(
  current: T,
  to: T,
  legal: Record<string, readonly string[]>,
  subject: string,
): void {
  const allowed = legal[current];
  if (!allowed?.includes(to)) {
    throw Errors.conflict(`${subject}: transición ${current} → ${to} ilegal`);
  }
}

async function setRouteStatus(params: {
  orgId: string;
  route: typeof routes.$inferSelect;
  toStatus: string;
  actorId: string;
  actorRole: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
  /** Columnas extra a pisar en el mismo UPDATE (ej. `startedAt` al arrancar). */
  extraFields?: Partial<typeof routes.$inferInsert>;
  tx: Tx;
}): Promise<void> {
  const {
    orgId,
    route,
    toStatus,
    actorId,
    actorRole,
    metadata,
    occurredAt,
    extraFields,
    tx,
  } = params;
  assertTransition(
    route.status,
    toStatus,
    TRANSITIONS_ROUTE,
    `ruta ${route.routeNumber}`,
  );

  const now = occurredAt ?? new Date();
  await tx
    .update(routes)
    .set({
      status: toStatus as typeof routes.$inferSelect.status,
      updatedAt: now,
      ...extraFields,
    })
    .where(eq(routes.id, route.id));
  await logDomainEvent(
    {
      orgId,
      entityType: "ROUTE",
      entityId: route.id,
      eventType: "ROUTE_STATUS_CHANGED",
      actorId,
      actorRole,
      fromStatus: route.status,
      toStatus,
      metadata,
      occurredAt: now,
    },
    tx,
  );
}

async function setVehicleStatus(params: {
  orgId: string;
  vehicle: typeof vehicles.$inferSelect;
  toStatus: string;
  actorId: string;
  actorRole: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
  tx: Tx;
}): Promise<void> {
  const { orgId, vehicle, toStatus, actorId, actorRole, metadata, occurredAt, tx } =
    params;
  assertTransition(
    vehicle.status,
    toStatus,
    TRANSITIONS_VEHICLE,
    `vehículo ${vehicle.plate}`,
  );

  const now = occurredAt ?? new Date();
  await tx
    .update(vehicles)
    .set({ status: toStatus as typeof vehicles.$inferSelect.status, updatedAt: now })
    .where(eq(vehicles.id, vehicle.id));
  await logDomainEvent(
    {
      orgId,
      entityType: "VEHICLE",
      entityId: vehicle.id,
      eventType: "VEHICLE_STATUS_CHANGED",
      actorId,
      actorRole,
      fromStatus: vehicle.status,
      toStatus,
      metadata,
      occurredAt: now,
    },
    tx,
  );
}

/** Vuelve a leer una ruta por id — para no armar el estado final con un objeto en memoria que quedó viejo tras un UPDATE. */
async function reloadRoute(
  route: typeof routes.$inferSelect,
): Promise<typeof routes.$inferSelect> {
  const [fresh] = await db.select().from(routes).where(eq(routes.id, route.id));
  return fresh ?? route;
}

async function getDriverRoute(
  orgId: string,
  driverId: string,
  statuses: readonly RouteStatus[],
): Promise<typeof routes.$inferSelect | null> {
  const rows = await db
    .select()
    .from(routes)
    .where(
      and(
        eq(routes.orgId, orgId),
        eq(routes.assignedDriverId, driverId),
        inArray(routes.status, statuses),
        isNull(routes.deletedAt),
      ),
    )
    .orderBy(desc(routes.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function getOpenCustody(
  orgId: string,
  routeId: string,
): Promise<typeof custodyTransfers.$inferSelect | null> {
  const rows = await db
    .select()
    .from(custodyTransfers)
    .where(and(eq(custodyTransfers.orgId, orgId), eq(custodyTransfers.routeId, routeId)))
    .orderBy(desc(custodyTransfers.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function countRouteStops(orgId: string, routeId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(routeStops)
    .innerJoin(routes, eq(routes.id, routeStops.routeId))
    .where(and(eq(routeStops.routeId, routeId), eq(routes.orgId, orgId)));
  return Number(rows[0]?.n ?? 0);
}

/** Bultos de la ruta ya escaneados en esta custodia (scan LOADING, sin duplicados). */
async function countCustodyScans(
  orgId: string,
  driverId: string,
  routeId: string,
  since: Date,
): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(packageScans)
    .innerJoin(packages, eq(packages.id, packageScans.packageId))
    .where(
      and(
        eq(packageScans.orgId, orgId),
        eq(packageScans.scannedBy, driverId),
        eq(packageScans.scanContext, "LOADING"),
        gte(packageScans.scannedAt, since),
        eq(packages.routeId, routeId),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

export interface CustodyStateResult {
  route: {
    id: string;
    routeNumber: number;
    status: string;
    plannedStops: number | null;
    colorHex: string | null;
    containerId: string | null;
  } | null;
  container: { id: string; code: string; type: string } | null;
  custody: {
    id: string;
    method: string;
    status: string;
    expectedCount: number;
    countedCount: number | null;
    discrepancyNotes: string | null;
    overrideReason: string | null;
    transferredAt: Date;
  } | null;
  scannedCount: number;
  canStart: boolean;
}

async function buildCustodyState(
  orgId: string,
  driverId: string,
  route: typeof routes.$inferSelect,
): Promise<CustodyStateResult> {
  const acta = await getOpenCustody(orgId, route.id);

  let container: CustodyStateResult["container"] = null;
  if (route.containerId) {
    const [c] = await db
      .select()
      .from(containers)
      .where(eq(containers.id, route.containerId));
    container = c ? { id: c.id, code: c.code, type: c.type } : null;
  }

  const counted = acta != null && acta.countedCount != null;
  const custodyOk =
    counted && CUSTODY_OK_STATUSES.some((s) => s === (acta?.status ?? ""));

  const scannedCount =
    acta && counted
      ? await countCustodyScans(orgId, driverId, route.id, acta.transferredAt)
      : 0;

  return {
    route: {
      id: route.id,
      routeNumber: route.routeNumber,
      status: route.status,
      plannedStops: route.plannedStops,
      colorHex: route.colorHex,
      containerId: route.containerId,
    },
    container,
    custody: acta
      ? {
          id: acta.id,
          method: acta.method,
          status: acta.status,
          expectedCount: acta.expectedCount,
          countedCount: acta.countedCount,
          discrepancyNotes: acta.discrepancyNotes,
          overrideReason: acta.overrideReason,
          transferredAt: acta.transferredAt,
        }
      : null,
    scannedCount,
    canStart: custodyOk && route.status === "ASSIGNED",
  };
}

/** Estado actual de la custodia del chofer para su ruta activa (GET /api/driver/custody). */
export async function getDriverCustodyState(
  orgId: string,
  driverId: string,
): Promise<CustodyStateResult> {
  const route = await getDriverRoute(orgId, driverId, ACTIVE_ROUTE_STATUSES);
  if (!route) {
    return {
      route: null,
      container: null,
      custody: null,
      scannedCount: 0,
      canStart: false,
    };
  }
  return buildCustodyState(orgId, driverId, route);
}

export interface StartCustodyInput {
  containerCode: string;
  lat?: number;
  lng?: number;
}

/**
 * Paso 1 — el chofer escanea el QR/código del contenedor asignado a su ruta
 * y se abre el acta de custodia (aún sin conteo). Idempotente: si ya hay
 * acta abierta para la ruta, devuelve el estado actual sin crear otra.
 */
export async function startCustody(
  orgId: string,
  driverId: string,
  input: StartCustodyInput,
): Promise<CustodyStateResult> {
  const route = await getDriverRoute(orgId, driverId, CUSTODY_PENDING_ROUTE_STATUSES);
  if (!route) {
    throw Errors.conflict(
      "no tenés una ruta aprobada para tomar custodia — tu ruta ya está en otro estado",
    );
  }

  const existing = await getOpenCustody(orgId, route.id);
  if (existing) return buildCustodyState(orgId, driverId, route);

  if (!route.containerId) {
    throw Errors.validation(
      "la ruta no tiene contenedor asignado — pedile al depósito que lo asigne antes de escanear",
    );
  }
  if (!route.vehicleId) {
    throw Errors.validation("la ruta no tiene vehículo asignado");
  }

  const [container] = await db
    .select()
    .from(containers)
    .where(
      and(
        eq(containers.orgId, orgId),
        eq(containers.isActive, true),
        isNull(containers.deletedAt),
        or(
          eq(containers.qrPayload, input.containerCode),
          eq(containers.code, input.containerCode),
        ),
      ),
    );
  if (!container) {
    throw Errors.notFound(
      "contenedor no encontrado — revisá que el QR/código sea de FYC",
    );
  }
  if (container.id !== route.containerId) {
    throw Errors.validation(
      `el contenedor escaneado (${container.code}) no es el asignado a tu ruta`,
    );
  }

  // El contenedor es físico y se custodia de a una ruta a la vez (§9.3).
  const [busy] = await db
    .select({ id: custodyTransfers.id })
    .from(custodyTransfers)
    .innerJoin(routes, eq(routes.id, custodyTransfers.routeId))
    .where(
      and(
        eq(custodyTransfers.orgId, orgId),
        eq(custodyTransfers.containerId, container.id),
        ne(custodyTransfers.routeId, route.id),
        inArray(routes.status, ACTIVE_ROUTE_STATUSES),
      ),
    )
    .limit(1);
  if (busy) {
    throw Errors.conflict("el contenedor ya está en custodia con otra ruta activa");
  }

  const expectedCount = await countRouteStops(orgId, route.id);

  await db.transaction(async (tx) => {
    const [acta] = await tx
      .insert(custodyTransfers)
      .values({
        orgId,
        routeId: route.id,
        containerId: container.id,
        toUserId: driverId,
        expectedCount,
        method: "COUNT",
        lat: input.lat,
        lng: input.lng,
      })
      .returning({ id: custodyTransfers.id });
    if (!acta) throw Errors.internal("no se pudo abrir el acta de custodia");

    await logDomainEvent(
      {
        orgId,
        entityType: "CUSTODY",
        entityId: acta.id,
        eventType: "CUSTODY_STARTED",
        actorId: driverId,
        actorRole: "driver",
        fromStatus: null,
        toStatus: "OPEN",
        lat: input.lat,
        lng: input.lng,
        metadata: { routeId: route.id, containerId: container.id, expectedCount },
      },
      tx,
    );
    return acta.id;
  });

  return buildCustodyState(orgId, driverId, route);
}

export interface SubmitCustodyCountInput {
  routeId: string;
  countedCount: number;
  lat?: number;
  lng?: number;
}

/**
 * Paso 2 — el chofer registra el conteo real de bultos. Si coincide con el
 * esperado el acta queda OK y la custodia se confirma (ruta APPROVED →
 * ASSIGNED, paquetes → CARGADO); si no, queda DISCREPANCY y la ruta NO
 * puede iniciar (§9.3) hasta full scan u override.
 */
export async function submitCustodyCount(
  orgId: string,
  driverId: string,
  input: SubmitCustodyCountInput,
): Promise<CustodyStateResult> {
  const route = await getDriverRoute(orgId, driverId, CUSTODY_PENDING_ROUTE_STATUSES);
  if (!route || route.id !== input.routeId) {
    throw Errors.conflict("no tenés una ruta aprobada con custodia pendiente");
  }

  const acta = await getOpenCustody(orgId, route.id);
  if (!acta) {
    throw Errors.validation("primero escaneá el contenedor para abrir el acta");
  }
  if (acta.countedCount != null) {
    throw Errors.conflict("el conteo de esta custodia ya se cargó");
  }
  if (!Number.isInteger(input.countedCount) || input.countedCount < 0) {
    throw Errors.validation("el conteo debe ser un número entero no negativo");
  }

  const matched = input.countedCount === acta.expectedCount;

  await db.transaction(async (tx) => {
    await tx
      .update(custodyTransfers)
      .set({
        countedCount: input.countedCount,
        status: matched ? "OK" : "DISCREPANCY",
        discrepancyNotes: matched
          ? null
          : `el chofer contó ${input.countedCount} bultos, se esperaban ${acta.expectedCount}`,
        lat: input.lat ?? acta.lat,
        lng: input.lng ?? acta.lng,
        updatedAt: new Date(),
      })
      .where(eq(custodyTransfers.id, acta.id));

    await logDomainEvent(
      {
        orgId,
        entityType: "CUSTODY",
        entityId: acta.id,
        eventType: "CUSTODY_COUNTED",
        actorId: driverId,
        actorRole: "driver",
        fromStatus: "OPEN",
        toStatus: matched ? "OK" : "DISCREPANCY",
        lat: input.lat,
        lng: input.lng,
        metadata: {
          routeId: route.id,
          countedCount: input.countedCount,
          expectedCount: acta.expectedCount,
        },
      },
      tx,
    );
  });

  if (matched) {
    await applyCustodyConfirmed(orgId, driverId, route, acta.id);
  }

  // `applyCustodyConfirmed` pudo haber pasado la ruta APPROVED -> ASSIGNED
  // en la base — releer antes de armar el estado final, si no `canStart`
  // se calcula con el `route` en memoria (todavía APPROVED) y da false
  // aunque la custodia haya quedado confirmada.
  const freshRoute = matched ? await reloadRoute(route) : route;
  return buildCustodyState(orgId, driverId, freshRoute);
}

/**
 * Confirma la custodia: ruta APPROVED → ASSIGNED y cada paquete ASIGNADO →
 * CARGADO. Los paquetes se transicionan FUERA de la transacción de la ruta,
 * mismo patrón que `approveRoute()`/`scanPackage()` (ver docs/DECISIONES.md):
 * `runPackageTransition` abre su propia transacción, anidarla causaría
 * deadlock de locks entre conexiones del pool.
 */
async function applyCustodyConfirmed(
  orgId: string,
  driverId: string,
  route: typeof routes.$inferSelect,
  actaId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(routes)
      .where(eq(routes.id, route.id))
      .for("update");
    if (!locked) throw Errors.notFound("la ruta dejó de existir");

    if (locked.status === "APPROVED") {
      await setRouteStatus({
        orgId,
        route: locked,
        toStatus: "ASSIGNED",
        actorId: driverId,
        actorRole: "driver",
        metadata: { custodyId: actaId },
        tx,
      });
    }
  });

  const routePackages = await db
    .select({ id: packages.id, status: packages.status })
    .from(packages)
    .where(and(eq(packages.routeId, route.id), eq(packages.orgId, orgId)));

  for (const p of routePackages) {
    if (p.status !== "ASIGNADO") continue; // ya transicionado o en excepción — no reintentar a ciegas
    await runPackageTransition({
      packageId: p.id,
      toStatus: "CARGADO",
      actorId: driverId,
      actorRoles: ["driver"],
      metadata: { custodyId: actaId, routeId: route.id },
    });
  }
}

export interface CustodyScanInput {
  routeId: string;
  rawCode: string;
  codeFormat?: CodeFormat;
  deviceId?: string;
  lat?: number;
  lng?: number;
}

export interface CustodyScanResult {
  match: "matched" | "wrong_route" | "extra";
  duplicate: boolean;
  package: {
    packageId: string;
    internalCode: string;
    bulkNumber: number | null;
    sequence: number | null;
  } | null;
  otherRouteNumber?: number;
  scannedCount: number;
  expectedCount: number;
}

/**
 * Paso 3 — escaneo individual de bultos (método FULL_SCAN), obligatorio ante
 * una diferencia de conteo (§9.3). Chequeo cruzado: si el código no es de
 * esta ruta se busca en las demás rutas activas de la operación y se reporta
 * "bulto no encontrado — pertenece a la ruta NNN".
 */
export async function scanPackageForCustody(
  orgId: string,
  driverId: string,
  input: CustodyScanInput,
): Promise<CustodyScanResult> {
  const route = await getDriverRoute(orgId, driverId, CUSTODY_SCAN_ROUTE_STATUSES);
  if (!route || route.id !== input.routeId) {
    throw Errors.conflict("no tenés una ruta activa que coincida con el escaneo");
  }

  const acta = await getOpenCustody(orgId, route.id);
  if (!acta) throw Errors.validation("no hay acta de custodia abierta para esta ruta");
  if (acta.countedCount == null) {
    throw Errors.validation("primero cargá el conteo para saber si hay diferencia");
  }
  if (acta.status !== "DISCREPANCY") {
    throw Errors.conflict(
      `la custodia está ${acta.status} — no se requiere escaneo de bultos`,
    );
  }

  const codeFormat = input.codeFormat ?? detectCodeFormat(input.rawCode);

  const [pkgInRoute] = await db
    .select({
      id: packages.id,
      internalCode: packages.internalCode,
      bulkNumber: packages.bulkNumber,
      sequence: routeStops.sequence,
    })
    .from(packages)
    .innerJoin(
      routeStops,
      and(eq(routeStops.packageId, packages.id), eq(routeStops.routeId, route.id)),
    )
    .where(
      and(
        eq(packages.routeId, route.id),
        eq(packages.orgId, orgId),
        or(
          eq(packages.internalCode, input.rawCode),
          eq(packages.trackingCode, input.rawCode),
        ),
      ),
    )
    .limit(1);

  const [prevScan] = pkgInRoute
    ? await db
        .select({ id: packageScans.id })
        .from(packageScans)
        .where(
          and(
            eq(packageScans.packageId, pkgInRoute.id),
            eq(packageScans.scanContext, "LOADING"),
            eq(packageScans.scannedBy, driverId),
            eq(packageScans.orgId, orgId),
          ),
        )
        .limit(1)
    : [];

  await db.insert(packageScans).values({
    packageId: pkgInRoute?.id ?? null,
    orgId,
    rawCode: input.rawCode,
    codeFormat,
    scannedBy: driverId,
    deviceId: input.deviceId,
    lat: input.lat,
    lng: input.lng,
    scanContext: "LOADING",
  });

  if (acta.method !== "FULL_SCAN") {
    await db
      .update(custodyTransfers)
      .set({ method: "FULL_SCAN", updatedAt: new Date() })
      .where(eq(custodyTransfers.id, acta.id));
  }

  const scannedCount = await countCustodyScans(
    orgId,
    driverId,
    route.id,
    acta.transferredAt,
  );

  if (pkgInRoute) {
    return {
      match: "matched",
      duplicate: Boolean(prevScan),
      package: {
        packageId: pkgInRoute.id,
        internalCode: pkgInRoute.internalCode,
        bulkNumber: pkgInRoute.bulkNumber,
        sequence: pkgInRoute.sequence,
      },
      scannedCount,
      expectedCount: acta.expectedCount,
    };
  }

  // Chequeo cruzado (§9.3): ¿el código pertenece a otra ruta activa de la operación?
  const [other] = await db
    .select({ routeNumber: routes.routeNumber })
    .from(packages)
    .innerJoin(
      routes,
      and(eq(routes.id, packages.routeId), inArray(routes.status, ACTIVE_ROUTE_STATUSES)),
    )
    .where(
      and(
        eq(packages.orgId, orgId),
        eq(packages.operationId, route.operationId),
        ne(packages.routeId, route.id),
        or(
          eq(packages.internalCode, input.rawCode),
          eq(packages.trackingCode, input.rawCode),
        ),
      ),
    )
    .limit(1);

  if (other) {
    return {
      match: "wrong_route",
      duplicate: false,
      package: null,
      otherRouteNumber: other.routeNumber,
      scannedCount,
      expectedCount: acta.expectedCount,
    };
  }

  return {
    match: "extra",
    duplicate: false,
    package: null,
    scannedCount,
    expectedCount: acta.expectedCount,
  };
}

export interface CustodyFinishResult {
  status: "RESOLVED" | "DISCREPANCY";
  missing: { packageId: string; internalCode: string; bulkNumber: number | null }[];
  extra: { rawCode: string; otherRouteNumber: number | null }[];
}

/**
 * Paso 4 — cierra el escaneo individual. Sin faltantes ni sobrantes → el
 * acta pasa a RESOLVED (la diferencia de conteo era un error) y la custodia
 * se confirma. Con faltantes/sobrantes → sigue DISCREPANCY con la lista.
 *
 * El universo de scans se acota a los posteriores al `transferred_at` del
 * acta para no contaminar con scans de una custodia anterior del mismo
 * chofer (misma org, mismo dispositivo).
 */
export async function finishFullScan(
  orgId: string,
  driverId: string,
  input: { routeId: string },
): Promise<CustodyFinishResult> {
  const route = await getDriverRoute(orgId, driverId, CUSTODY_SCAN_ROUTE_STATUSES);
  if (!route || route.id !== input.routeId) {
    throw Errors.conflict("no tenés una ruta activa que coincida");
  }

  const acta = await getOpenCustody(orgId, route.id);
  if (!acta) throw Errors.validation("no hay acta de custodia para esta ruta");
  if (acta.status !== "DISCREPANCY") {
    throw Errors.conflict(`la custodia está ${acta.status} — el escaneo ya se cerró`);
  }

  const routePackages = await db
    .select({
      id: packages.id,
      internalCode: packages.internalCode,
      bulkNumber: packages.bulkNumber,
    })
    .from(packages)
    .where(and(eq(packages.routeId, route.id), eq(packages.orgId, orgId)));

  const scans = await db
    .select({ packageId: packageScans.packageId, rawCode: packageScans.rawCode })
    .from(packageScans)
    .where(
      and(
        eq(packageScans.orgId, orgId),
        eq(packageScans.scannedBy, driverId),
        eq(packageScans.scanContext, "LOADING"),
        gte(packageScans.scannedAt, acta.transferredAt),
      ),
    );

  const routePackageIds = new Set(routePackages.map((p) => p.id));
  const matchedIds = new Set<string>();
  const extras: { rawCode: string; otherRouteNumber: number | null }[] = [];
  for (const scan of scans) {
    if (scan.packageId && routePackageIds.has(scan.packageId)) {
      matchedIds.add(scan.packageId);
    } else {
      extras.push({ rawCode: scan.rawCode, otherRouteNumber: null });
    }
  }

  // Reporte: cada sobrante con su ruta de origen (si existe) para que el
  // depósito la devuelva al contenedor correcto.
  for (const extra of extras) {
    const [other] = await db
      .select({ routeNumber: routes.routeNumber })
      .from(packages)
      .innerJoin(
        routes,
        and(
          eq(routes.id, packages.routeId),
          inArray(routes.status, ACTIVE_ROUTE_STATUSES),
        ),
      )
      .where(
        and(
          eq(packages.orgId, orgId),
          eq(packages.operationId, route.operationId),
          or(
            eq(packages.internalCode, extra.rawCode),
            eq(packages.trackingCode, extra.rawCode),
          ),
        ),
      )
      .limit(1);
    extra.otherRouteNumber = other?.routeNumber ?? null;
  }

  const missing = routePackages
    .filter((p) => !matchedIds.has(p.id))
    .map((p) => ({
      packageId: p.id,
      internalCode: p.internalCode,
      bulkNumber: p.bulkNumber,
    }));

  if (missing.length === 0 && extras.length === 0) {
    await db.transaction(async (tx) => {
      await tx
        .update(custodyTransfers)
        .set({
          status: "RESOLVED",
          resolvedBy: driverId,
          resolvedAt: new Date(),
          discrepancyNotes: null,
          updatedAt: new Date(),
        })
        .where(eq(custodyTransfers.id, acta.id));

      await logDomainEvent(
        {
          orgId,
          entityType: "CUSTODY",
          entityId: acta.id,
          eventType: "CUSTODY_FULL_SCAN_RESOLVED",
          actorId: driverId,
          actorRole: "driver",
          fromStatus: "DISCREPANCY",
          toStatus: "RESOLVED",
          metadata: { routeId: route.id, scannedCount: matchedIds.size },
        },
        tx,
      );
    });

    await applyCustodyConfirmed(orgId, driverId, route, acta.id);
    return { status: "RESOLVED", missing: [], extra: [] };
  }

  await db
    .update(custodyTransfers)
    .set({
      discrepancyNotes: `falta(n) ${missing.length}, sobrante(s) ${extras.length} — chequeo cruzado pendiente`,
      updatedAt: new Date(),
    })
    .where(eq(custodyTransfers.id, acta.id));

  return { status: "DISCREPANCY", missing, extra: extras };
}

/**
 * Paso 5 — el dispatcher overridea la diferencia con motivo obligatorio.
 * Solo aplica a un acta en DISCREPANCY; el motivo queda auditado en el acta
 * y en el evento.
 */
export async function overrideCustody(
  orgId: string,
  routeId: string,
  actor: { userId: string; roles: readonly Role[] },
  reason: string,
): Promise<CustodyStateResult> {
  const [route] = await db
    .select()
    .from(routes)
    .where(and(eq(routes.id, routeId), eq(routes.orgId, orgId)));
  if (!route) throw Errors.notFound("ruta no encontrada");
  if (route.status !== "APPROVED" && route.status !== "ASSIGNED") {
    throw Errors.conflict(`la ruta está ${route.status} — el override ya no aplica`);
  }
  if (!route.assignedDriverId) {
    throw Errors.conflict("la ruta no tiene chofer asignado");
  }

  const acta = await getOpenCustody(orgId, route.id);
  if (!acta) throw Errors.validation("no hay acta de custodia para override");
  if (acta.status !== "DISCREPANCY") {
    throw Errors.conflict(
      `la custodia está ${acta.status} — solo se overridean diferencias`,
    );
  }
  if (!reason || reason.trim().length === 0) {
    throw Errors.validation("el override requiere un motivo obligatorio");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(custodyTransfers)
      .set({
        status: "OVERRIDDEN",
        resolvedBy: actor.userId,
        resolvedAt: new Date(),
        overrideReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(custodyTransfers.id, acta.id));

    await logDomainEvent(
      {
        orgId,
        entityType: "CUSTODY",
        entityId: acta.id,
        eventType: "CUSTODY_OVERRIDDEN",
        actorId: actor.userId,
        actorRole: actor.roles.join(","),
        fromStatus: "DISCREPANCY",
        toStatus: "OVERRIDDEN",
        metadata: { routeId: route.id, reason },
      },
      tx,
    );
  });

  // Las transiciones de paquete y el evento de ruta se ejecutan en nombre
  // del chofer (solo "driver" puede pasar ASIGNADO→CARGADO, §3) — la
  // decisión del dispatcher queda auditada en CUSTODY_OVERRIDDEN.
  await applyCustodyConfirmed(orgId, route.assignedDriverId, route, acta.id);

  // Mismo motivo que en `submitCustodyCount`: releer la ruta después de
  // `applyCustodyConfirmed`, si no `canStart` sale false con el estado
  // viejo (APPROVED) aunque la ruta ya haya pasado a ASSIGNED.
  const freshRoute = await reloadRoute(route);
  return buildCustodyState(orgId, route.assignedDriverId, freshRoute);
}

export interface StartRouteInput {
  routeId: string;
  gpsAccuracyM: number;
  lat?: number;
  lng?: number;
  batteryLevel?: number;
  batteryOptimizationDisabled: boolean;
  locationPermissionGranted: boolean;
  routeDownloaded: boolean;
}

export interface StartRouteResult {
  routeId: string;
  status: "IN_TRANSIT";
  startedAt: string;
  warnings: { batteryLow: boolean };
}

/**
 * Paso 6 — INICIAR RUTA. Checklist §9.4 validado en el servidor: lo que el
 * servidor sabe de verdad (custodia confirmada, vehículo AVAILABLE) es duro;
 * los estados del dispositivo (permisos, optimización de batería, ruta
 * descargada) viajan como atestaciones del chofer — el servidor las exige
 * para no dejar que un cliente mintiera sobre el checklist, y quedan
 * registradas en el evento de la ruta. La batería baja (<20%) NO bloquea,
 * solo advierte (§9.4: "warning, no bloqueante").
 */
export async function startRoute(
  orgId: string,
  driverId: string,
  input: StartRouteInput,
): Promise<StartRouteResult> {
  const route = await getDriverRoute(orgId, driverId, ["ASSIGNED"]);
  if (!route || route.id !== input.routeId) {
    throw Errors.conflict(
      "no tenés una ruta asignada con custodia confirmada para iniciar",
    );
  }

  if (!input.locationPermissionGranted) {
    throw Errors.validation(
      "se requiere el permiso de ubicación (incluido en background) para iniciar la ruta",
    );
  }
  if (!input.batteryOptimizationDisabled) {
    throw Errors.validation(
      "desactivá la optimización de batería antes de iniciar la ruta",
    );
  }
  if (!input.routeDownloaded) {
    throw Errors.validation("la ruta debe estar descargada completa a este dispositivo");
  }
  const accuracy = input.gpsAccuracyM;
  if (!Number.isFinite(accuracy)) {
    throw Errors.validation("falta la precisión GPS del dispositivo");
  }
  if (accuracy > 50) {
    throw Errors.validation("la precisión GPS debe ser menor a 50m para iniciar la ruta");
  }

  const acta = await getOpenCustody(orgId, route.id);
  if (!acta) throw Errors.conflict("no hay custodia registrada para esta ruta");
  if (acta.countedCount == null) {
    throw Errors.conflict("la custodia todavía no se contó");
  }
  if (!CUSTODY_OK_STATUSES.some((s) => s === acta.status)) {
    throw Errors.conflict(
      "la custodia tiene diferencias sin resolver — no se puede iniciar la ruta",
    );
  }

  const [vehicle] = route.vehicleId
    ? await db.select().from(vehicles).where(eq(vehicles.id, route.vehicleId))
    : [];
  if (!vehicle) throw Errors.validation("la ruta no tiene vehículo asignado");
  if (vehicle.status !== "AVAILABLE") {
    throw Errors.conflict(
      `el vehículo está ${vehicle.status} — no se puede iniciar la ruta`,
    );
  }

  const startedAt = new Date();
  const actaId = acta.id;
  await db.transaction(async (tx) => {
    await setRouteStatus({
      orgId,
      route,
      toStatus: "IN_TRANSIT",
      actorId: driverId,
      actorRole: "driver",
      metadata: {
        custodyId: actaId,
        gpsAccuracyM: accuracy,
        batteryLevel: input.batteryLevel ?? null,
        batteryOptimizationDisabled: input.batteryOptimizationDisabled,
        locationPermissionGranted: input.locationPermissionGranted,
        routeDownloaded: input.routeDownloaded,
      },
      occurredAt: startedAt,
      extraFields: { startedAt },
      tx,
    });

    await setVehicleStatus({
      orgId,
      vehicle,
      toStatus: "IN_ROUTE",
      actorId: driverId,
      actorRole: "driver",
      occurredAt: startedAt,
      tx,
    });
  });

  // Paquetes CARGADO → EN_REPARTO (fuera de la transacción, patrón estándar).
  const routePackages = await db
    .select({ id: packages.id, status: packages.status })
    .from(packages)
    .where(and(eq(packages.routeId, route.id), eq(packages.orgId, orgId)));

  for (const p of routePackages) {
    if (p.status !== "CARGADO") continue;
    await runPackageTransition({
      packageId: p.id,
      toStatus: "EN_REPARTO",
      actorId: driverId,
      actorRoles: ["driver"],
      metadata: { routeId: route.id, custodyId: actaId },
    });
  }

  return {
    routeId: route.id,
    status: "IN_TRANSIT",
    startedAt: startedAt.toISOString(),
    warnings: { batteryLow: input.batteryLevel != null && input.batteryLevel < 0.2 },
  };
}

/** Asigna (o desasigna) el contenedor físico de una ruta — panel web, §9.2/§9.3. */
export async function assignRouteContainer(
  orgId: string,
  routeId: string,
  actor: { userId: string; roles: readonly Role[] },
  containerId: string | null,
): Promise<{ containerId: string | null }> {
  const [route] = await db
    .select()
    .from(routes)
    .where(and(eq(routes.id, routeId), eq(routes.orgId, orgId)));
  if (!route) throw Errors.notFound("ruta no encontrada");
  if (
    route.status !== "DRAFT" &&
    route.status !== "PROPOSED" &&
    route.status !== "APPROVED"
  ) {
    throw Errors.conflict(
      `la ruta está ${route.status} — el contenedor ya no se puede cambiar`,
    );
  }

  if (containerId) {
    const [container] = await db
      .select()
      .from(containers)
      .where(
        and(
          eq(containers.id, containerId),
          eq(containers.orgId, orgId),
          eq(containers.isActive, true),
        ),
      );
    if (!container) throw Errors.notFound("contenedor no encontrado o inactivo");

    const [busy] = await db
      .select({ id: routes.id })
      .from(routes)
      .where(
        and(
          eq(routes.containerId, containerId),
          eq(routes.orgId, orgId),
          inArray(routes.status, ACTIVE_ROUTE_STATUSES),
          ne(routes.id, routeId),
        ),
      )
      .limit(1);
    if (busy) {
      throw Errors.conflict("el contenedor ya está asignado a otra ruta activa");
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(routes)
      .set({ containerId, updatedAt: new Date() })
      .where(eq(routes.id, routeId));

    await logDomainEvent(
      {
        orgId,
        entityType: "ROUTE",
        entityId: route.id,
        eventType: "ROUTE_CONTAINER_ASSIGNED",
        actorId: actor.userId,
        actorRole: actor.roles.join(","),
        fromStatus: route.status,
        metadata: { containerId },
      },
      tx,
    );
  });

  return { containerId };
}

export type { Tx as CustodyTx };
export { CUSTODY_OK_STATUSES, CUSTODY_PENDING_ROUTE_STATUSES };
