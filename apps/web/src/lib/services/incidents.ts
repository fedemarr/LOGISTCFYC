/**
 * RESOLUCIÓN DE INCIDENCIAS — PROMPT-MAESTRO §9.7 (FASE 12).
 *
 * El chofer reporta la falla (DELIVERY_FAILED, ver `delivery.ts`); la
 * RESOLUCIÓN la decide Operaciones desde la bandeja, nunca el chofer.
 * Este módulo es el único punto de escritura de `incidents.resolution` /
 * `resolved_by` / `resolved_at` / `response_time_s` y aplica el efecto de
 * negocio de cada decisión sobre el paquete y la parada:
 *
 *   - RETRY_NOW       → paquete FALLA_REPORTADA → EN_REPARTO (reintenta hoy)
 *                       y la parada FAILED → PENDING (vuelve a la secuencia).
 *   - RESCHEDULE      → FALLA_REPORTADA → REPROGRAMADO (otro día de reparto).
 *   - RETURN          → FALLA_REPORTADA → DEVUELTO (vuelve al depósito).
 *   - DELIVER_ANYWAY  → FALLA_REPORTADA → ENTREGADO (override: la foto de la
 *                       incidencia del chofer vale como evidencia del receptor).
 *   - CANCEL          → FALLA_REPORTADA → CANCELADO (motivo obligatorio).
 *
 * SLA interno (§9.7): `response_time_s` se mide entre `created_at` del
 * incidente y la resolución. Si nadie responde en `INCIDENT_SLA_SECONDS`
 * (10 min por default), la bandeja marca la incidencia como vencida y
 * `escalateOverdueIncidents` la resuelve por default con RETURN — nunca
 * un chofer esperando indefinidamente.
 */
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import type { Role } from "@fyc/shared";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { incidents, packages, routeStops } from "@/lib/db/schema";
import { logDomainEvent } from "./events";
import { sendPushToUser } from "./notifications";
import { runPackageTransition } from "./state-machine";

export type IncidentResolution =
  "RETRY_NOW" | "RESCHEDULE" | "RETURN" | "DELIVER_ANYWAY" | "CANCEL";

export interface ResolveIncidentInput {
  resolution: IncidentResolution;
  note?: string;
  /** Motivo obligatorio para CANCEL — se propaga al paquete CANCELADO. */
  cancelReason?: string;
}

export interface ResolveIncidentResult {
  incidentId: string;
  resolution: IncidentResolution;
  responseTimeS: number;
  packageStatus: string;
}

/** La transición legal de la máquina de estados para cada resolución. */
const RESOLUTION_TO_TRANSITION: Record<
  IncidentResolution,
  { toStatus: "EN_REPARTO" | "REPROGRAMADO" | "DEVUELTO" | "ENTREGADO" | "CANCELADO" }
> = {
  RETRY_NOW: { toStatus: "EN_REPARTO" },
  RESCHEDULE: { toStatus: "REPROGRAMADO" },
  RETURN: { toStatus: "DEVUELTO" },
  DELIVER_ANYWAY: { toStatus: "ENTREGADO" },
  CANCEL: { toStatus: "CANCELADO" },
};

async function getOpenIncident(
  orgId: string,
  incidentId: string,
): Promise<{
  incident: typeof incidents.$inferSelect;
  pkg: typeof packages.$inferSelect | null;
  stop: typeof routeStops.$inferSelect | null;
}> {
  const rows = await db
    .select({
      incident: incidents,
      pkg: packages,
      stop: routeStops,
    })
    .from(incidents)
    .leftJoin(packages, eq(packages.id, incidents.packageId))
    .leftJoin(routeStops, eq(routeStops.packageId, incidents.packageId))
    .where(
      and(
        eq(incidents.id, incidentId),
        eq(incidents.orgId, orgId),
        inArray(incidents.status, ["OPEN", "ASSIGNED"]),
        isNull(incidents.resolvedAt),
      ),
    );
  const row = rows[0];
  if (!row) {
    throw Errors.notFound(
      "la incidencia no existe, no es de tu organización o ya está resuelta",
    );
  }
  return { incident: row.incident, pkg: row.pkg, stop: row.stop };
}

/**
 * Resuelve una incidencia abierta con la decisión de Operaciones (§9.7).
 * Solo admin/dispatcher. Aplica la transición de paquete y, cuando
 * corresponde, la parada (RETRY_NOW → PENDING; DELIVER_ANYWAY → COMPLETED).
 */
export async function resolveIncident(
  orgId: string,
  incidentId: string,
  input: ResolveIncidentInput,
  actor: { userId: string; roles: readonly Role[] },
): Promise<ResolveIncidentResult> {
  const { incident, pkg, stop } = await getOpenIncident(orgId, incidentId);

  const resolvedAt = new Date();
  const responseTimeS = Math.max(
    0,
    Math.round((resolvedAt.getTime() - incident.createdAt.getTime()) / 1000),
  );

  if (!pkg) {
    throw Errors.conflict(
      "la incidencia no tiene paquete asociado — no se puede resolver",
    );
  }

  if (input.resolution === "CANCEL" && !input.cancelReason?.trim()) {
    throw Errors.validation("cancelar requiere un motivo (cancelReason)");
  }

  const { toStatus } = RESOLUTION_TO_TRANSITION[input.resolution];

  await db.transaction(async (tx) => {
    await tx
      .update(incidents)
      .set({
        status: "RESOLVED",
        resolution: input.resolution,
        resolvedBy: actor.userId,
        resolvedAt,
        responseTimeS,
        ...(input.note?.trim()
          ? {
              description: [incident.description, input.note.trim()]
                .filter(Boolean)
                .join("\n"),
            }
          : {}),
        updatedAt: resolvedAt,
      })
      .where(eq(incidents.id, incident.id));

    const metadata: Record<string, unknown> = {
      incidentId: incident.id,
      resolution: input.resolution,
      resolvedBy: actor.userId,
      ...(input.note?.trim() ? { resolutionNote: input.note.trim() } : {}),
    };

    if (input.resolution === "DELIVER_ANYWAY") {
      // La foto de la incidencia (subida por el chofer) es la evidencia del
      // receptor para el override de la máquina de estados (§9.7 "ENTREGAR IGUAL").
      const photoUrl = incident.photoUrls[0];
      if (!photoUrl) {
        throw Errors.preconditionFailed(
          "entregar igual pese a la incidencia requiere la foto de evidencia del chofer",
        );
      }
      metadata.driverEvidencePhotoUrl = photoUrl;
    }
    if (input.resolution === "CANCEL") {
      metadata.reason = input.cancelReason!.trim();
    }

    // Toda la mutación (incidente + paquete + parada + evento) en la MISMA
    // transacción: si la transición de estado falla, el incidente NO queda
    // marcado como resuelto (FASE 13 — atomicidad).
    await runPackageTransition(
      {
        packageId: pkg.id,
        toStatus,
        actorId: actor.userId,
        actorRoles: actor.roles,
        metadata,
      },
      tx,
    );

    if (stop) {
      if (input.resolution === "RETRY_NOW") {
        await tx
          .update(routeStops)
          .set({ status: "PENDING", updatedAt: resolvedAt })
          .where(eq(routeStops.id, stop.id));
      }
      if (input.resolution === "DELIVER_ANYWAY") {
        await tx
          .update(routeStops)
          .set({ status: "COMPLETED", updatedAt: resolvedAt })
          .where(eq(routeStops.id, stop.id));
      }
    }

    await logDomainEvent(
      {
        orgId,
        entityType: "INCIDENT",
        entityId: incident.id,
        eventType: "INCIDENT_RESOLVED",
        actorId: actor.userId,
        actorRole: actor.roles.join(","),
        fromStatus: incident.status,
        toStatus: "RESOLVED",
        metadata: {
          packageId: pkg.id,
          resolution: input.resolution,
          responseTimeS,
          ...(input.note?.trim() ? { note: input.note.trim() } : {}),
        },
        occurredAt: resolvedAt,
      },
      tx,
    );
  });

  await notifyDriverOfResolution(orgId, incident, pkg, input.resolution);

  return {
    incidentId: incident.id,
    resolution: input.resolution,
    responseTimeS,
    packageStatus: toStatus,
  };
}

/**
 * SLA §9.7: las incidencias abiertas que superaron `INCIDENT_SLA_SECONDS`
 * sin resolución se resuelven por default con RETURN. Se invoca desde la
 * bandeja (on-read, sin jobs) antes de armar el inbox — idempotente.
 */
export async function escalateOverdueIncidents(orgId: string): Promise<string[]> {
  const slaSeconds = Number(process.env.INCIDENT_SLA_SECONDS ?? 600);
  const threshold = new Date(Date.now() - slaSeconds * 1000);

  const overdue = await db
    .select({ id: incidents.id })
    .from(incidents)
    .where(
      and(
        eq(incidents.orgId, orgId),
        inArray(incidents.status, ["OPEN", "ASSIGNED"]),
        isNull(incidents.resolvedAt),
        sql`${incidents.createdAt} < ${threshold}`,
      ),
    );

  const resolved: string[] = [];
  for (const row of overdue) {
    try {
      const actor = {
        userId: "00000000-0000-0000-0000-000000000000",
        roles: ["dispatcher"] as Role[],
      };
      await resolveIncident(
        orgId,
        row.id,
        {
          resolution: "RETURN",
          note: "SLA vencido — devolución automática por default (§9.7)",
        },
        actor,
      );
      resolved.push(row.id);
    } catch {
      // No bloquear la bandeja por un incidente que no se pudo auto-resolver.
    }
  }
  return resolved;
}

const RESOLUTION_DRIVER_MESSAGE: Record<IncidentResolution, string> = {
  RETRY_NOW: "Operaciones decidió reintentar la entrega hoy",
  RESCHEDULE: "Operaciones reprogramó la entrega para otro día",
  RETURN: "Operaciones ordenó devolver el paquete al depósito",
  DELIVER_ANYWAY: "Operaciones confirmó la entrega (entregar igual)",
  CANCEL: "Operaciones canceló el paquete",
};

/**
 * Notifica por push al chofer que reportó la incidencia cuando Operaciones
 * la resuelve (no se notifica la auto-escala del SLA, ya que ahí el chofer
 * fue quien esperó demasiado — igual se le avisa para que no quede dudando).
 */
async function notifyDriverOfResolution(
  orgId: string,
  incident: typeof incidents.$inferSelect,
  pkg: typeof packages.$inferSelect,
  resolution: IncidentResolution,
): Promise<void> {
  if (!incident.driverId || resolution === "CANCEL") return;
  await sendPushToUser(orgId, incident.driverId, {
    title: "Tu incidencia fue resuelta",
    body: `${RESOLUTION_DRIVER_MESSAGE[resolution]} · ${pkg.internalCode}`,
    data: { packageId: pkg.id, incidentId: incident.id, resolution },
  });
}
