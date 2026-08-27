import { sql } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";

/**
 * Escritura de eventos de dominio contra `public.log_event(...)` — el
 * SECURITY DEFINER de la migración 0001 que valida org_id y escribe en la
 * tabla append-only `events` (ver `schema/events.ts`, §7: "EL CORAZÓN DEL
 * SISTEMA").
 *
 * Helpers compartido para los flujos FYM (turnos, zonas, alertas) sin
 * duplicar la misma llamada SQL con sus tipos. SIEMPRE se llama dentro de
 * una transacción — si el evento no se puede escribir, la operación se
 * revierte completa.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const DOMAIN_ENTITY_TYPES = ["SHIFT", "ZONE", "ALERT", "USER"] as const;
export type DomainEntityType = (typeof DOMAIN_ENTITY_TYPES)[number];

export interface DomainEventParams {
  orgId: string;
  entityType: DomainEntityType;
  entityId: string;
  eventType: string;
  actorId: string;
  /** Roles del actor unidos con coma ("admin,dispatcher") — un usuario puede tener varios (§3). */
  actorRole: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  lat?: number | null;
  lng?: number | null;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

export async function logDomainEvent(params: DomainEventParams, tx: Tx): Promise<string> {
  const result = await tx.execute(sql`
    select public.log_event(
      ${params.orgId}::uuid,
      ${params.entityType}::event_entity_type,
      ${params.entityId}::uuid,
      ${params.eventType},
      ${params.actorId}::uuid,
      ${params.actorRole},
      ${params.fromStatus ?? null},
      ${params.toStatus ?? null},
      ${params.lat ?? null},
      ${params.lng ?? null},
      ${JSON.stringify(params.metadata ?? {})}::jsonb,
      NULL,
      ${params.occurredAt ?? new Date()}
    ) as id
  `);

  const row = result.rows[0] as { id: string } | undefined;
  if (!row) {
    throw Errors.internal("log_event no devolvió el id del evento");
  }
  return row.id;
}
