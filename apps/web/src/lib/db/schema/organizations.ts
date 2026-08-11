import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Hoy hay una sola organización, pero PROMPT-MAESTRO §7 exige `org_id` en
 * TODAS las tablas de negocio desde el día 1 ("agregarlo después cuesta una
 * migración dolorosa; agregarlo ahora cuesta una columna").
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Argentina/Buenos_Aires"),
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
