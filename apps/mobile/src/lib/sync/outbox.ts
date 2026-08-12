import type { SQLiteDatabase } from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import type { SyncOperationType } from "@fyc/shared";
import type { OutboxRow } from "../db/schema";
import { getNextAttemptAt } from "./backoff";

/**
 * Operaciones de outbox que tocan SQLite — separadas de la lógica pura
 * (`backoff.ts`, `mapper.ts`) para que esa lógica se pueda testear sin
 * mockear `expo-sqlite`. Esto es el "adapter", no tiene decisiones
 * propias más allá de armar el SQL.
 */

/** Encola una acción — PRIMERO en SQLite, la UI ya puede responder optimista (§12, regla 1-2). */
export async function enqueueAction(
  db: SQLiteDatabase,
  operationType: SyncOperationType,
  payload: Record<string, unknown>,
): Promise<string> {
  const idempotencyKey = randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO outbox (idempotency_key, operation_type, payload, client_timestamp, status, attempts, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
    idempotencyKey,
    operationType,
    JSON.stringify(payload),
    now,
    now,
    now,
  );
  return idempotencyKey;
}

/** Lo que está listo para mandar ahora: nunca intentado, o el backoff ya venció. */
export async function getDueActions(
  db: SQLiteDatabase,
  now: Date = new Date(),
): Promise<OutboxRow[]> {
  return db.getAllAsync<OutboxRow>(
    `SELECT * FROM outbox WHERE next_attempt_at <= ? ORDER BY created_at ASC LIMIT 50`,
    now.toISOString(),
  );
}

export async function getPendingCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) as n FROM outbox`);
  return row?.n ?? 0;
}

/** El servidor confirmó (aplicada o ya la tenía) — recién ahí se borra local (§12, regla 8). */
export async function deleteActions(
  db: SQLiteDatabase,
  idempotencyKeys: string[],
): Promise<void> {
  if (idempotencyKeys.length === 0) return;
  const placeholders = idempotencyKeys.map(() => "?").join(",");
  await db.runAsync(
    `DELETE FROM outbox WHERE idempotency_key IN (${placeholders})`,
    ...idempotencyKeys,
  );
}

export async function markActionFailed(
  db: SQLiteDatabase,
  idempotencyKey: string,
  attempts: number,
  error: string,
): Promise<void> {
  const nextAttempts = attempts + 1;
  await db.runAsync(
    `UPDATE outbox SET status = 'failed', attempts = ?, last_error = ?, next_attempt_at = ? WHERE idempotency_key = ?`,
    nextAttempts,
    error,
    getNextAttemptAt(nextAttempts),
    idempotencyKey,
  );
}
