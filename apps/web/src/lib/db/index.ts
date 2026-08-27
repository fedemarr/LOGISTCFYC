import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Cliente Drizzle del servidor. `DATABASE_URL` apunta al Session Pooler de
 * Supabase (puerto 5432, no conexión directa — necesario por IPv4, ver
 * ADR-015), que tiene un límite bajo de clientes simultáneos (15 en este
 * proyecto) compartido entre TODO lo que se conecta: cada función
 * serverless de Vercel, scripts locales, tests.
 *
 * `max` bajo a propósito: el default de `pg.Pool` es 10 — con eso, una
 * sola invocación fría de una función serverless ya se come 2/3 del cupo
 * total ella sola, y ni hace falta mucho tráfico concurrente para agotar
 * el pool entero (error real visto en prod: "no se pudo verificar la
 * sesión" — la conexión a la base fallaba con "max clients reached in
 * session mode", no un problema de auth). Cada función Lambda de Vercel
 * ya es su propia unidad de concurrencia — no necesita un pool grande
 * puertas adentro, necesita dejarle lugar al resto.
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

const pool = new Pool({
  connectionString: getDatabaseUrl(),
  max: 3,
  // Libera conexiones ociosas rápido — una función de Vercel puede quedar
  // "warm" un rato sin recibir tráfico, y mientras tanto no tiene sentido
  // que retenga conexiones del pool de 15 que otra instancia necesita ya.
  idleTimeoutMillis: 10_000,
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;
