import type { SyncAction, SyncActionResult, SyncOperationType } from "@fyc/shared";
import type { OutboxRow } from "../db/schema";

/**
 * Traducción pura entre las filas de SQLite (payload serializado como
 * texto, tal como lo exige `expo-sqlite`) y el `SyncAction` que espera
 * `POST /api/sync` (payload como objeto). Separado del módulo que toca
 * la base (`outbox.ts`) para poder testearlo sin mocks de SQLite/RN.
 */
export function rowToSyncAction(row: OutboxRow): SyncAction {
  return {
    idempotencyKey: row.idempotency_key,
    operationType: row.operation_type as SyncOperationType,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    clientTimestamp: row.client_timestamp,
  };
}

export interface OutboxOutcome {
  /** Se pueden borrar del outbox local: el servidor ya las tiene aplicadas (o ya las tenía). */
  toDelete: string[];
  /** Quedan, pero con el error/intento actualizado para el próximo backoff. */
  toRetry: { idempotencyKey: string; error: string }[];
}

/** Separa los resultados del servidor en "borrar del outbox" vs "reintentar más tarde" — nunca se borra nada hasta que el servidor confirma (§12, regla 8). */
export function partitionSyncResults(results: SyncActionResult[]): OutboxOutcome {
  const toDelete: string[] = [];
  const toRetry: OutboxOutcome["toRetry"] = [];

  for (const result of results) {
    if (result.status === "COMPLETED" || result.status === "DUPLICATE") {
      toDelete.push(result.idempotencyKey);
    } else {
      toRetry.push({
        idempotencyKey: result.idempotencyKey,
        error: result.error ?? "error desconocido",
      });
    }
  }

  return { toDelete, toRetry };
}
