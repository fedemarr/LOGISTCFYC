/**
 * EXPORTACIÓN A CSV — PROMPT-MAESTRO §7 (FASE 12): "Exportación a
 * CSV/Excel". Genera CSV UTF-8 con BOM (para que Excel abra los acentos
 * bien) a partir de las tablas operativas. Todo es de lectura, filtrado
 * por org y por rango de fechas cuando corresponde.
 */
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  clients,
  deliveries,
  incidents,
  operations,
  packages,
  routes,
  users,
} from "@/lib/db/schema";

export type ExportType = "packages" | "deliveries" | "incidents" | "operations";

const INCIDENT_REASON_LABELS: Record<string, string> = {
  NO_ONE_HOME: "No hay nadie",
  NO_ANSWER: "No atiende",
  WRONG_ADDRESS: "Dirección errónea",
  NONEXISTENT_ADDRESS: "Dirección inexistente",
  REFUSED: "Rechaza el paquete",
  NO_ACCESS: "Sin acceso",
  UNSAFE_AREA: "Zona insegura",
  VEHICLE_ISSUE: "Problema del vehículo",
  DAMAGED: "Bulto dañado",
  MISSING_BULK: "Bulto faltante",
  OTHER: "Otro",
};

const INCIDENT_RESOLUTION_LABELS: Record<string, string> = {
  RETRY_NOW: "Reintentar hoy",
  RESCHEDULE: "Reprogramar",
  RETURN: "Devolver",
  DELIVER_ANYWAY: "Entregar igual",
  CANCEL: "Cancelar",
};

function csvEscape(value: unknown): string {
  if (value == null) return "";
  let str = String(value);
  // Inyección de fórmulas CSV (OWASP): un valor que arranca con = + - @ o
  // tab/CR puede ser interpretado como fórmula por Excel/Sheets al abrir el
  // archivo. Se neutraliza anteponiendo un apóstrofo (Excel lo ignora y
  // muestra el texto literal).
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const headerLine = headers.map(csvEscape).join(",");
  const bodyLines = rows.map((r) => r.map(csvEscape).join(","));
  // BOM UTF-8 para Excel.
  return `\uFEFF${headerLine}\n${bodyLines.join("\n")}\n`;
}

export function buildCsv(
  type: ExportType,
  rows: (string | number | null | undefined)[][],
  from?: Date,
  to?: Date,
): { content: string; filename: string } {
  let headers: string[];
  let filename: string;
  switch (type) {
    case "packages":
      headers = [
        "código_interno",
        "tracking",
        "estado",
        "destinatario",
        "teléfono",
        "dirección",
        "cliente",
        "operación",
        "reintentos",
        "creado",
      ];
      filename = "paquetes";
      break;
    case "deliveries":
      headers = [
        "código_interno",
        "tracking",
        "chofer",
        "receptor",
        "resultado",
        "distancia_m",
        "lat",
        "lng",
        "entregado",
      ];
      filename = "entregas";
      break;
    case "incidents":
      headers = [
        "código_interno",
        "ruta",
        "chofer",
        "motivo",
        "resolución",
        "descripción",
        "creado",
        "resuelto",
      ];
      filename = "incidencias";
      break;
    case "operations":
      headers = ["fecha", "estado", "esperados", "recibidos", "creado"];
      filename = "operaciones";
      break;
  }

  const datePart =
    from && to
      ? `-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`
      : `-${new Date().toISOString().slice(0, 10)}`;

  return { content: toCsv(headers, rows), filename: `${filename}${datePart}.csv` };
}

/** Fila de paquete con joins a cliente/operación. */
export async function exportPackagesCsv(
  orgId: string,
  opts?: { operationId?: string; statuses?: string[] },
): Promise<{ content: string; filename: string }> {
  const rows = await db
    .select({
      internalCode: packages.internalCode,
      trackingCode: packages.trackingCode,
      status: packages.status,
      recipientName: packages.recipientName,
      recipientPhone: packages.recipientPhone,
      rawAddressText: packages.rawAddressText,
      clientName: clients.name,
      operationDate: operations.operationDate,
      deliveryAttempts: packages.deliveryAttempts,
      createdAt: packages.createdAt,
    })
    .from(packages)
    .leftJoin(clients, eq(clients.id, packages.clientId))
    .leftJoin(operations, eq(operations.id, packages.operationId))
    .where(
      and(
        eq(packages.orgId, orgId),
        isNull(packages.deletedAt),
        ...(opts?.operationId ? [eq(packages.operationId, opts.operationId)] : []),
        ...(opts?.statuses?.length
          ? [inArray(packages.status, opts.statuses as never[])]
          : []),
      ),
    )
    .orderBy(packages.createdAt);

  const data = rows.map((r) => [
    r.internalCode,
    r.trackingCode,
    r.status,
    r.recipientName,
    r.recipientPhone,
    r.rawAddressText,
    r.clientName,
    r.operationDate,
    r.deliveryAttempts,
    r.createdAt.toISOString(),
  ]);
  return buildCsv("packages", data);
}

/** Fila de entrega con joins a paquete/chofer. */
export async function exportDeliveriesCsv(
  orgId: string,
  from: Date,
  to: Date,
): Promise<{ content: string; filename: string }> {
  const rows = await db
    .select({
      internalCode: packages.internalCode,
      trackingCode: packages.trackingCode,
      driverName: users.fullName,
      receiverName: deliveries.receiverName,
      outcome: deliveries.outcome,
      distanceFromTargetM: deliveries.distanceFromTargetM,
      lat: deliveries.lat,
      lng: deliveries.lng,
      deliveredAt: deliveries.deliveredAt,
    })
    .from(deliveries)
    .leftJoin(packages, eq(packages.id, deliveries.packageId))
    .leftJoin(users, eq(users.id, deliveries.driverId))
    .where(
      and(
        eq(deliveries.orgId, orgId),
        gte(deliveries.deliveredAt, from),
        lte(deliveries.deliveredAt, to),
      ),
    )
    .orderBy(deliveries.deliveredAt);

  const data = rows.map((r) => [
    r.internalCode,
    r.trackingCode,
    r.driverName,
    r.receiverName,
    r.outcome,
    r.distanceFromTargetM,
    r.lat,
    r.lng,
    r.deliveredAt.toISOString(),
  ]);
  return buildCsv("deliveries", data, from, to);
}

/** Fila de incidente con joins. */
export async function exportIncidentsCsv(
  orgId: string,
  from: Date,
  to: Date,
): Promise<{ content: string; filename: string }> {
  const rows = await db
    .select({
      internalCode: packages.internalCode,
      routeNumber: routes.routeNumber,
      driverName: users.fullName,
      reason: incidents.reason,
      resolution: incidents.resolution,
      description: incidents.description,
      createdAt: incidents.createdAt,
      resolvedAt: incidents.resolvedAt,
    })
    .from(incidents)
    .leftJoin(packages, eq(packages.id, incidents.packageId))
    .leftJoin(routes, eq(routes.id, incidents.routeId))
    .leftJoin(users, eq(users.id, incidents.driverId))
    .where(
      and(
        eq(incidents.orgId, orgId),
        gte(incidents.createdAt, from),
        lte(incidents.createdAt, to),
      ),
    )
    .orderBy(incidents.createdAt);

  const data = rows.map((r) => [
    r.internalCode,
    r.routeNumber,
    r.driverName,
    INCIDENT_REASON_LABELS[r.reason] ?? r.reason,
    r.resolution ? (INCIDENT_RESOLUTION_LABELS[r.resolution] ?? r.resolution) : "",
    r.description,
    r.createdAt.toISOString(),
    r.resolvedAt?.toISOString() ?? "",
  ]);
  return buildCsv("incidents", data, from, to);
}

/** Operaciones (fecha, estado, conteos). */
export async function exportOperationsCsv(
  orgId: string,
): Promise<{ content: string; filename: string }> {
  const rows = await db
    .select({
      operationDate: operations.operationDate,
      status: operations.status,
      expectedCount: operations.expectedCount,
      receivedCount: operations.receivedCount,
      createdAt: operations.createdAt,
    })
    .from(operations)
    .where(and(eq(operations.orgId, orgId), isNull(operations.deletedAt)))
    .orderBy(desc(operations.createdAt));

  const data = rows.map((r) => [
    r.operationDate,
    r.status,
    r.expectedCount,
    r.receivedCount,
    r.createdAt.toISOString(),
  ]);
  return buildCsv("operations", data);
}
