import {
  transition,
  type PackageStatus,
  type TransitionDeps,
  type TransitionMetadata,
  type TransitionRequest,
  type TransitionResult,
} from "@fyc/state-machine";
import { and, eq, sql } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { packages } from "@/lib/db/schema";

/**
 * Conecta la máquina de estados (package agnóstico de base de datos) a
 * Drizzle/Postgres. Es la ÚNICA forma de cambiar el estado de un paquete
 * desde el backend (PROMPT-MAESTRO §4: "Ningún módulo puede hacer un
 * UPDATE packages SET status = ... directo").
 *
 * Todo corre dentro de una `db.transaction()`:
 *   1. `getCurrentStatus` lee `packages.status` con `FOR UPDATE` (lock de
 *      fila → dos transiciones concurrentes del mismo paquete se serializan,
 *      no hay condición de carrera).
 *   2. `applyTransition` hace el `UPDATE packages SET status = ...`.
 *   3. Escribe el evento con `public.log_event(...)` (SECURITY DEFINER de la
 *      migración 0001) en la MISMA transacción.
 * Si el evento falla, la transacción se revierte por completo (§4).
 */
const PACKAGE_STATUS_EVENT_TYPE = "PACKAGE_STATUS_CHANGED";

interface LockedPackage {
  status: PackageStatus;
  orgId: string;
}

function gpsFromMetadata(metadata: TransitionMetadata): {
  lat: number | null;
  lng: number | null;
} {
  const gps = metadata.gps;
  if (typeof gps === "object" && gps !== null) {
    const g = gps as Record<string, unknown>;
    if (typeof g.lat === "number" && typeof g.lng === "number") {
      return { lat: g.lat, lng: g.lng };
    }
  }
  return { lat: null, lng: null };
}

async function logPackageEvent(params: {
  orgId: string;
  packageId: string;
  actorId: string;
  actorRole: string;
  fromStatus: string;
  toStatus: string;
  metadata: TransitionMetadata;
  occurredAt: Date;
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0];
}): Promise<string> {
  const {
    orgId,
    packageId,
    actorId,
    actorRole,
    fromStatus,
    toStatus,
    metadata,
    occurredAt,
    tx,
  } = params;
  const gps = gpsFromMetadata(metadata);

  const result = await tx.execute(sql`
    select public.log_event(
      ${orgId}::uuid,
      'PACKAGE'::event_entity_type,
      ${packageId}::uuid,
      ${PACKAGE_STATUS_EVENT_TYPE},
      ${actorId}::uuid,
      ${actorRole},
      ${fromStatus},
      ${toStatus},
      ${gps.lat},
      ${gps.lng},
      ${JSON.stringify(metadata)}::jsonb,
      NULL,
      ${occurredAt}
    ) as id
  `);

  const row = result.rows[0] as { id: string } | undefined;
  if (!row) {
    throw Errors.internal("log_event no devolvió el id del evento");
  }
  return row.id;
}

/** Ejecuta una transición de paquete completa, atómica y auditada. */
export async function runPackageTransition(
  request: TransitionRequest,
): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    let locked: LockedPackage | null = null;

    const deps: TransitionDeps = {
      async getCurrentStatus(packageId: string): Promise<LockedPackage["status"]> {
        const rows = await tx
          .select({ status: packages.status, orgId: packages.orgId })
          .from(packages)
          .where(eq(packages.id, packageId))
          .for("update");

        const row = rows[0];
        if (!row) {
          throw Errors.notFound(`paquete ${packageId} no existe`);
        }
        locked = { status: row.status, orgId: row.orgId };
        return row.status;
      },

      async applyTransition(params) {
        if (!locked) {
          throw Errors.internal("applyTransition llamado sin lock previo");
        }
        const now = new Date();

        const [updated] = await tx
          .update(packages)
          .set({ status: params.toStatus, updatedAt: now })
          .where(and(eq(packages.id, params.packageId), eq(packages.orgId, locked.orgId)))
          .returning({ id: packages.id });

        if (!updated) {
          throw Errors.notFound("el paquete dejó de existir dentro de la transacción");
        }

        const eventId = await logPackageEvent({
          orgId: locked.orgId,
          packageId: params.packageId,
          actorId: params.actorId,
          actorRole: params.actorRoles.join(","),
          fromStatus: params.fromStatus,
          toStatus: params.toStatus,
          metadata: params.metadata,
          occurredAt: now,
          tx,
        });

        return { eventId };
      },
    };

    return transition(request, deps);
  });
}
