/**
 * TIMELINE DE PAQUETE — PROMPT-MAESTRO §7 (FASE 12): "Cada paquete tiene
 * un timeline completo y verificable de extremo a extremo", criterio de
 * aceptación global #9.
 *
 * Lee el event log append-only (`events`) filtrando por entity_type=PACKAGE
 * y entity_id=packageId, en orden cronológico. Es la fuente de verdad de
 * la historia del bulto: ingesta → geocoding → ruteo → custodia →
 * reparto → entrega/incidencia → resolución.
 */
import { and, asc, eq } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { events, packages, users } from "@/lib/db/schema";

export interface PackageTimelineEvent {
  eventId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorName: string | null;
  actorRole: string | null;
  lat: number | null;
  lng: number | null;
  occurredAt: string;
  recordedAt: string;
  metadata: Record<string, unknown>;
}

export interface PackageTimeline {
  packageId: string;
  internalCode: string;
  trackingCode: string | null;
  currentStatus: string;
  events: PackageTimelineEvent[];
}

/** Timeline completo de un paquete, en orden cronológico. */
export async function getPackageTimeline(
  orgId: string,
  packageId: string,
): Promise<PackageTimeline> {
  const [pkg] = await db
    .select({
      id: packages.id,
      internalCode: packages.internalCode,
      trackingCode: packages.trackingCode,
      status: packages.status,
    })
    .from(packages)
    .where(and(eq(packages.id, packageId), eq(packages.orgId, orgId)));
  if (!pkg) throw Errors.notFound("el paquete no existe en tu organización");

  const rows = await db
    .select({
      eventId: events.id,
      eventType: events.eventType,
      fromStatus: events.previousState,
      toStatus: events.newState,
      actorName: users.fullName,
      actorRole: events.actorRole,
      lat: events.lat,
      lng: events.lng,
      occurredAt: events.occurredAt,
      recordedAt: events.recordedAt,
      metadata: events.metadata,
    })
    .from(events)
    .leftJoin(users, eq(users.id, events.actorId))
    .where(
      and(
        eq(events.orgId, orgId),
        eq(events.entityType, "PACKAGE"),
        eq(events.entityId, packageId),
      ),
    )
    .orderBy(asc(events.occurredAt));

  return {
    packageId: pkg.id,
    internalCode: pkg.internalCode,
    trackingCode: pkg.trackingCode,
    currentStatus: pkg.status,
    events: rows.map((r) => ({
      eventId: r.eventId,
      eventType: r.eventType,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      actorName: r.actorName,
      actorRole: r.actorRole,
      lat: r.lat,
      lng: r.lng,
      occurredAt: r.occurredAt.toISOString(),
      recordedAt: r.recordedAt.toISOString(),
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
    })),
  };
}
