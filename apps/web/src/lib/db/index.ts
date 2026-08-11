import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Cliente Drizzle del servidor. Usa `DATABASE_URL` (conexión directa a
 * Postgres, no el pooler de PgBouncer) — ver .env.example y §18.
 *
 * ⚠️ Solo se importa desde código de servidor (Route Handlers, jobs). Nunca
 * desde un Client Component: expondría la connection string.
 */
function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL no está definida. Copiá .env.example a .env y completala.",
    );
  }
  return url;
}

const pool = new Pool({ connectionString: getDatabaseUrl() });

export const db = drizzle(pool, { schema });
export type Database = typeof db;
