/**
 * DASHBOARD OPERATIVO Y MÉTRICAS — PROMPT-MAESTRO §7/§13, FASE 12.
 *
 * Todo de LECTURA y computado on-read (sin jobs ni materialización): el
 * panel es de volumen chico (1-10 choferes) y el costo de las agregaciones
 * es despreciable. Se calcula con la data ya persistida:
 *
 *   - Dashboard operativo: paquetes por estado, rutas activas/completadas,
 *     choferes en ruta, entregas de hoy.
 *   - Métricas de reparto: entregas/día, por chofer, tasa de éxito,
 *     paquetes/hora, km recorridos, tiempo por entrega, incidencias,
 *     reintentos.
 *   - Métricas económicas (solo admin): rentabilidad por cliente. El costo
 *     por entrega NO se calcula porque la tarifa/estructura de costos es
 *     una decisión de negocio pendiente (§20 #6) — el endpoint devuelve
 *     null en los campos que dependen de esa configuración.
 */
import { and, count, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, deliveries, incidents, packages, routes, users } from "@/lib/db/schema";

export interface OperationsDashboard {
  packagesByStatus: { status: string; count: number }[];
  routesActive: number;
  routesCompletedToday: number;
  driversOnRoute: number;
  driversOnline: number;
  deliveriesToday: number;
  failuresToday: number;
}

export interface DeliveryMetrics {
  range: { from: string; to: string };
  deliveries: number;
  failures: number;
  successRate: number;
  deliveredByDriver: { driverId: string; driverName: string; count: number }[];
  deliveriesPerDay: { day: string; count: number }[];
  packagesPerHour: number | null;
  totalKm: number | null;
  avgSecondsPerDelivery: number | null;
  incidents: number;
  retries: number;
}

export interface FinancialMetrics {
  range: { from: string; to: string };
  deliveries: number;
  declaredValueTotal: number | null;
  perClient: {
    clientId: string;
    clientName: string;
    deliveries: number;
    declaredValue: number | null;
  }[];
  /** Pendiente de configurar tarifas (§20 #6) — siempre null por ahora. */
  costPerDelivery: null;
  marginByRoute: null;
}

/** Inicio del día (UTC) para un offset de fecha dado. */
function dayStart(daysAgo = 0): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

/** GET /api/operations/dashboard — paquetes por estado + actividad del día. */
export async function getOperationsDashboard(
  orgId: string,
): Promise<OperationsDashboard> {
  const todayStart = dayStart(0);
  const tomorrowStart = dayStart(-1);

  const [byStatus, deliveriesToday, routesToday, driversToday] = await Promise.all([
    db
      .select({ status: packages.status, count: count() })
      .from(packages)
      .where(and(eq(packages.orgId, orgId), isNull(packages.deletedAt)))
      .groupBy(packages.status),
    db
      .select({ count: count() })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.orgId, orgId),
          gte(deliveries.deliveredAt, todayStart),
          lte(deliveries.deliveredAt, tomorrowStart),
        ),
      ),
    db
      .select({ status: routes.status, count: count() })
      .from(routes)
      .where(
        and(
          eq(routes.orgId, orgId),
          isNull(routes.deletedAt),
          gte(routes.createdAt, todayStart),
        ),
      )
      .groupBy(routes.status),
    db
      .select({ count: count() })
      .from(routes)
      .where(
        and(
          eq(routes.orgId, orgId),
          eq(routes.status, "IN_TRANSIT"),
          isNull(routes.deletedAt),
        ),
      ),
  ]);

  const routeCounts = Object.fromEntries(routesToday.map((r) => [r.status, r.count]));
  const failuresToday = await db
    .select({ count: count() })
    .from(incidents)
    .where(
      and(
        eq(incidents.orgId, orgId),
        gte(incidents.createdAt, todayStart),
        lte(incidents.createdAt, tomorrowStart),
      ),
    );

  const driversOnRoute = driversToday[0]?.count ?? 0;

  return {
    packagesByStatus: byStatus.map((r) => ({ status: r.status, count: r.count })),
    routesActive: routeCounts["IN_TRANSIT"] ?? 0,
    routesCompletedToday: routeCounts["COMPLETED"] ?? 0,
    driversOnRoute,
    driversOnline: driversOnRoute,
    deliveriesToday: deliveriesToday[0]?.count ?? 0,
    failuresToday: failuresToday[0]?.count ?? 0,
  };
}

/** GET /api/metrics/delivery?from=&to= — métricas operativas del rango. */
export async function getDeliveryMetrics(
  orgId: string,
  from: Date,
  to: Date,
): Promise<DeliveryMetrics> {
  const range = and(
    eq(deliveries.orgId, orgId),
    gte(deliveries.deliveredAt, from),
    lte(deliveries.deliveredAt, to),
  );

  const [
    deliveriesResult,
    failuresResult,
    byDriver,
    perDay,
    kmResult,
    incidentsResult,
    retriesResult,
  ] = await Promise.all([
    db.select({ count: count() }).from(deliveries).where(range),
    db
      .select({ count: count() })
      .from(deliveries)
      .where(and(range, eq(deliveries.outcome, "FAILED"))),
    db
      .select({
        driverId: deliveries.driverId,
        driverName: users.fullName,
        count: count(),
      })
      .from(deliveries)
      .leftJoin(users, eq(users.id, deliveries.driverId))
      .where(range)
      .groupBy(deliveries.driverId, users.fullName),
    db
      .select({
        day: sql<string>`to_char(${deliveries.deliveredAt}, 'YYYY-MM-DD')`,
        count: count(),
      })
      .from(deliveries)
      .where(range)
      .groupBy(sql`to_char(${deliveries.deliveredAt}, 'YYYY-MM-DD')`),
    db
      .select({ km: sql<number>`coalesce(sum(${routes.actualDistanceM}), 0)`.as("km") })
      .from(routes)
      .where(
        and(
          eq(routes.orgId, orgId),
          isNull(routes.deletedAt),
          gte(routes.startedAt, from),
          lte(routes.startedAt, to),
        ),
      ),
    db
      .select({ count: count() })
      .from(incidents)
      .where(
        and(
          eq(incidents.orgId, orgId),
          gte(incidents.createdAt, from),
          lte(incidents.createdAt, to),
        ),
      ),
    db
      .select({ count: count() })
      .from(packages)
      .where(
        and(
          eq(packages.orgId, orgId),
          sql`${packages.deliveryAttempts} > 1`,
          isNull(packages.deletedAt),
        ),
      ),
  ]);

  const deliveriesTotal = deliveriesResult[0]?.count ?? 0;
  const failuresTotal = failuresResult[0]?.count ?? 0;
  const successRate =
    deliveriesTotal > 0 ? (deliveriesTotal - failuresTotal) / deliveriesTotal : 0;

  const hours = Math.max(1, (to.getTime() - from.getTime()) / 3_600_000);
  const packagesPerHour = deliveriesTotal / hours;

  const avgSecondsPerDelivery = await avgSecondsPerDeliveryFor(orgId, from, to);

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    deliveries: deliveriesTotal,
    failures: failuresTotal,
    successRate,
    deliveredByDriver: byDriver.map((r) => ({
      driverId: r.driverId ?? "",
      driverName: r.driverName ?? "Sin asignar",
      count: r.count,
    })),
    deliveriesPerDay: perDay.map((r) => ({ day: r.day, count: r.count })),
    packagesPerHour,
    totalKm: Math.round(((kmResult[0]?.km ?? 0) / 1000) * 10) / 10,
    avgSecondsPerDelivery,
    incidents: incidentsResult[0]?.count ?? 0,
    retries: retriesResult[0]?.count ?? 0,
  };
}

async function avgSecondsPerDeliveryFor(
  orgId: string,
  from: Date,
  to: Date,
): Promise<number | null> {
  const [row] = await db
    .select({
      total: sql<number>`sum(${routes.actualDurationS})`.as("total"),
      stops: sql<number>`sum(${routes.plannedStops})`.as("stops"),
    })
    .from(routes)
    .where(
      and(
        eq(routes.orgId, orgId),
        isNull(routes.deletedAt),
        gte(routes.startedAt, from),
        lte(routes.startedAt, to),
        eq(routes.status, "COMPLETED"),
      ),
    );
  const total = row?.total ?? 0;
  const stops = row?.stops ?? 0;
  if (stops === 0) return null;
  return Math.round(total / stops);
}

/** GET /api/metrics/financial — rentabilidad por cliente. Solo admin. */
export async function getFinancialMetrics(
  orgId: string,
  from: Date,
  to: Date,
): Promise<FinancialMetrics> {
  const range = and(
    eq(deliveries.orgId, orgId),
    gte(deliveries.deliveredAt, from),
    lte(deliveries.deliveredAt, to),
  );

  const [deliveriesResult, perClient] = await Promise.all([
    db.select({ count: count() }).from(deliveries).where(range),
    db
      .select({
        clientId: packages.clientId,
        clientName: clients.name,
        deliveries: count(),
        declaredValue:
          sql<number>`sum(coalesce(${packages.declaredValue}::numeric, 0))`.as(
            "declared_value",
          ),
      })
      .from(deliveries)
      .innerJoin(packages, eq(packages.id, deliveries.packageId))
      .leftJoin(clients, eq(clients.id, packages.clientId))
      .where(range)
      .groupBy(packages.clientId, clients.name),
  ]);

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    deliveries: deliveriesResult[0]?.count ?? 0,
    declaredValueTotal: perClient.reduce(
      (acc, r) => acc + Number(r.declaredValue ?? 0),
      0,
    ),
    perClient: perClient.map((r) => ({
      clientId: r.clientId ?? "",
      clientName: r.clientName ?? "Sin cliente",
      deliveries: r.deliveries,
      declaredValue: Number(r.declaredValue ?? 0),
    })),
    costPerDelivery: null,
    marginByRoute: null,
  };
}
