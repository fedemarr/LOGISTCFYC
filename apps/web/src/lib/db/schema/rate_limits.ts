import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Rate limiting sin Redis (PROMPT-MAESTRO §5: "evaluar una tabla de
 * Postgres simple (rate_limits o similar) dado que ya se paga la conexión
 * a Postgres en cada request de todos modos").
 *
 * Infraestructura interna del backend: NO es una tabla de negocio. RLS
 * activo sin políticas → inaccesible desde el cliente (authenticated/anon),
 * solo la conexión de servidor (postgres) la toca. La limpieza de ventanas
 * viejas va en el job de mantenimiento de FASE 12/13.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(1),
  },
  (table) => [primaryKey({ columns: [table.key, table.windowStart] })],
);
