import {
  doublePrecision,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { eventEntityTypeEnum } from "./enums";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * EL CORAZÓN DEL SISTEMA (§7). Append-only: SIN `updated_at`, SIN
 * `deleted_at`, SIN UPDATE, SIN DELETE. Particionada por mes sobre
 * `occurred_at` (migración manual, igual que `driver_locations`).
 *
 * `correctsEventId` NO lleva FK a propósito: en Postgres, una tabla
 * particionada solo puede ser destino de una FK si la columna referenciada
 * forma parte de una constraint UNIQUE que incluya la columna de partición
 * (acá `occurred_at`) — o sea, no se puede declarar `UNIQUE(id)` sola en
 * una tabla particionada por `occurred_at`. La integridad de
 * "correction apunta a un evento que existe" se valida en el servicio de
 * eventos (FASE 3), no en la base. Ver docs/DECISIONES.md.
 *
 * ⚠️ REVOCAR UPDATE y DELETE a nivel Postgres para todos los roles de
 * aplicación — se hace en la migración manual, no acá.
 */
export const events = pgTable("events", {
  id: uuid("id").defaultRandom().notNull(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  entityType: eventEntityTypeEnum("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  actorId: uuid("actor_id").references(() => users.id),
  actorRole: varchar("actor_role", { length: 50 }),
  previousState: varchar("previous_state", { length: 100 }),
  newState: varchar("new_state", { length: 100 }),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  metadata: jsonb("metadata").notNull().default({}),
  correctsEventId: uuid("corrects_event_id"),
  /** Cuándo pasó de verdad (columna de partición). */
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  /** Cuándo lo recibió el servidor. */
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});
