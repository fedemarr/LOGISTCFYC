import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { Errors } from "./errors";

/**
 * Rate limiting sin Redis (PROMPT-MAESTRO §5) sobre la tabla `rate_limits`
 * (migración 0004). Ventana fija atómica con un solo UPSERT:
 *
 *   INSERT ... ON CONFLICT (key, window_start) DO UPDATE
 *     SET count = count + 1 WHERE count < :limit RETURNING count
 *
 * El `WHERE count < :limit` hace que el UPDATE no ocurra (y no devuelva
 * fila) cuando la ventana ya está llena → `RATE_LIMITED`. Es atómico: no
 * hay carrera entre chequear y contar, y no necesita transacción explícita.
 *
 * `key` identifica el bucket (p. ej. `transition:{userId}` o
 * `packages:list:{userId}`). La limpieza de ventanas viejas va en el job
 * de mantenimiento de FASE 12/13.
 */
export interface RateLimitOptions {
  limit: number;
  /** Duración de la ventana en segundos. */
  windowSeconds: number;
}

export async function consumeRateLimit(
  key: string,
  options: RateLimitOptions,
): Promise<void> {
  const { limit, windowSeconds } = options;
  const windowStart = new Date(
    Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000,
  );

  const result = await db.execute(sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key, window_start)
    DO UPDATE SET count = rate_limits.count + 1
    WHERE rate_limits.count < ${limit}
    RETURNING count
  `);

  if (result.rows.length === 0) {
    throw Errors.rateLimited();
  }
}
