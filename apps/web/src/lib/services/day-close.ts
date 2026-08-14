/**
 * CIERRE DEL DÍA CON RECONCILIACIÓN — PROMPT-MAESTRO §9.9 (FASE 12).
 *
 * Ecuación obligatoria: CARGADOS = ENTREGADOS + FALLIDOS + DEVUELTOS +
 * EN_DEPÓSITO. Si no cierra, el día NO se puede cerrar y se genera una
 * alerta (los paquetes devueltos se escanean al reingresar al depósito).
 *
 * "CARGADOS" = paquetes que salieron a la calle en alguna ruta del día
 * (estado CARGADO o posterior). Se computa sobre `route_stops` de las
 * rutas del día (cada paquete con su parada cargada). "EN_DEPÓSITO" =
 * todo lo que no salió ni se resolvió (queda en la operación).
 *
 * Cierre on-read, idempotente: marca el día cerrado en la operación
 * (`operations.status = CLOSED` cuando la operación del día balancea).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { operations, packages } from "@/lib/db/schema";
import { logDomainEvent } from "./events";
export interface DayReconciliation {
  date: string;
  operationId: string | null;
  operationStatus: string | null;
  /** Paquetes que salieron a la calle (cargados en rutas del día). */
  loaded: number;
  delivered: number;
  failed: number;
  returned: number;
  /** CARGADOS - (ENTREGADOS + FALLIDOS + DEVUELTOS + EN_DEPÓSITO) */
  difference: number;
  balanced: boolean;
  /** Detalle de lo que no cierra (paquetes en estados raros). */
  suspicious: { internalCode: string; status: string }[];
}

const IN_STREET_STATUSES = [
  "CARGADO",
  "EN_REPARTO",
  "EN_DOMICILIO",
  "ENTREGADO",
  "FALLA_REPORTADA",
  "DEVUELTO",
  "DANIADO",
  "EXTRAVIADO",
  "REPROGRAMADO",
] as const;

/**
 * GET (lectura) de la reconciliación del día para una operación (o la del
 * día actual si no se pasa `operationId`).
 */
export async function getDayReconciliation(
  orgId: string,
  operationId?: string,
): Promise<DayReconciliation> {
  const [operation] = operationId
    ? await db
        .select()
        .from(operations)
        .where(and(eq(operations.id, operationId), eq(operations.orgId, orgId)))
    : await db
        .select()
        .from(operations)
        .where(and(eq(operations.orgId, orgId), isNull(operations.deletedAt)))
        .orderBy(sql`${operations.operationDate} desc`)
        .limit(1);

  if (!operation) {
    throw Errors.notFound(operationId ? "la operación no existe" : "no hay operaciones");
  }

  const date = operation.operationDate;

  // Paquetes de la operación (todos).
  const pkgRows = await db
    .select({
      id: packages.id,
      internalCode: packages.internalCode,
      status: packages.status,
    })
    .from(packages)
    .where(
      and(
        eq(packages.orgId, orgId),
        eq(packages.operationId, operation.id),
        isNull(packages.deletedAt),
      ),
    );

  const statusCount = new Map<string, number>();
  for (const p of pkgRows) {
    statusCount.set(p.status, (statusCount.get(p.status) ?? 0) + 1);
  }

  const loaded = pkgRows.filter((p) =>
    IN_STREET_STATUSES.includes(p.status as (typeof IN_STREET_STATUSES)[number]),
  ).length;
  const delivered = statusCount.get("ENTREGADO") ?? 0;
  const failed = statusCount.get("FALLA_REPORTADA") ?? 0;
  const returned = statusCount.get("DEVUELTO") ?? 0;
  const enDeposito = pkgRows.filter(
    (p) => !IN_STREET_STATUSES.includes(p.status as (typeof IN_STREET_STATUSES)[number]),
  ).length;

  // Ecuación: CARGADOS = ENTREGADOS + FALLIDOS + DEVUELTOS + EN_DEPÓSITO
  const rightSide = delivered + failed + returned + enDeposito;
  const difference = loaded - rightSide;

  const suspicious = pkgRows.filter((p) =>
    ["DANIADO", "EXTRAVIADO", "REPROGRAMADO"].includes(p.status),
  );

  return {
    date: String(date),
    operationId: operation.id,
    operationStatus: operation.status,
    loaded,
    delivered,
    failed,
    returned,
    difference,
    balanced: difference === 0,
    suspicious: suspicious.map((p) => ({
      internalCode: p.internalCode,
      status: p.status,
    })),
  };
}

/**
 * POST (cierre): valida la ecuación y, si balancea, cierra la operación.
 * Si no balancea, tira error con el detalle (nunca deja que un día con
 * paquetes en el aire se cierre solo).
 */
export async function closeDay(
  orgId: string,
  operationId?: string,
  actor?: { userId: string; roles: readonly string[] },
): Promise<DayReconciliation & { closed: boolean }> {
  const rec = await getDayReconciliation(orgId, operationId);

  if (!rec.balanced) {
    throw Errors.preconditionFailed(
      `la operación del día ${rec.date} no balancea (diferencia ${rec.difference}): ` +
        `revisá ${rec.suspicious.length} paquete(s) en estado especial antes de cerrar`,
    );
  }
  if (rec.operationStatus === "CLOSED") {
    return { ...rec, closed: false };
  }
  if (!rec.operationId) {
    throw Errors.conflict("no hay operación del día que cerrar");
  }
  const targetOperationId: string = rec.operationId;

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(operations)
      .set({ status: "CLOSED", updatedAt: now })
      .where(eq(operations.id, targetOperationId));

    await logDomainEvent(
      {
        orgId,
        entityType: "OPERATION",
        entityId: targetOperationId,
        eventType: "OPERATION_CLOSED",
        actorId: actor?.userId ?? "00000000-0000-0000-0000-000000000000",
        actorRole: actor?.roles.join(",") ?? "system",
        fromStatus: rec.operationStatus,
        toStatus: "CLOSED",
        metadata: {
          date: rec.date,
          loaded: rec.loaded,
          delivered: rec.delivered,
          failed: rec.failed,
          returned: rec.returned,
          difference: rec.difference,
        },
        occurredAt: now,
      },
      tx,
    );
  });

  return { ...rec, closed: true };
}
