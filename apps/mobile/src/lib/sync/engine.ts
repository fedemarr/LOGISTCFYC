import type { SQLiteDatabase } from "expo-sqlite";
import type { SyncActionResult } from "@fyc/shared";
import { api } from "../api";
import { deleteActions, getDueActions, markActionFailed } from "./outbox";
import { partitionSyncResults, rowToSyncAction } from "./mapper";

export interface FlushResult {
  sent: number;
  completed: number;
  duplicate: number;
  failed: number;
}

/**
 * Un ciclo del motor de sync (§12): manda lo que está vencido de
 * reintentar, borra local lo que el servidor confirmó, y deja lo que
 * falló con su backoff actualizado para el próximo ciclo. Se llama desde
 * un timer periódico y desde el listener de reconexión de red — nunca
 * concurrente entre sí (ver `useSyncEngine` en `store.ts`, que serializa
 * con un flag `isSyncing`).
 */
export async function flush(db: SQLiteDatabase, deviceId: string): Promise<FlushResult> {
  const rows = await getDueActions(db);
  if (rows.length === 0) return { sent: 0, completed: 0, duplicate: 0, failed: 0 };

  const actions = rows.map(rowToSyncAction);
  const attemptsByKey = new Map(rows.map((r) => [r.idempotency_key, r.attempts]));

  let results: SyncActionResult[];
  try {
    const response = await api.post<{ results: SyncActionResult[] }>("/api/sync", {
      deviceId,
      actions,
    });
    results = response.results;
  } catch (err) {
    // Sin red o el servidor no respondió — nada que partitionar todavía,
    // las filas quedan como estaban y se reintentan en el próximo ciclo
    // (su `next_attempt_at` no cambió, así que siguen "vencidas").
    const message = err instanceof Error ? err.message : "error de red desconocido";
    for (const row of rows) {
      await markActionFailed(db, row.idempotency_key, row.attempts, message);
    }
    return { sent: 0, completed: 0, duplicate: 0, failed: rows.length };
  }

  const { toDelete, toRetry } = partitionSyncResults(results);
  await deleteActions(db, toDelete);
  for (const { idempotencyKey, error } of toRetry) {
    await markActionFailed(
      db,
      idempotencyKey,
      attemptsByKey.get(idempotencyKey) ?? 0,
      error,
    );
  }

  const completed = results.filter((r) => r.status === "COMPLETED").length;
  const duplicate = results.filter((r) => r.status === "DUPLICATE").length;
  return { sent: rows.length, completed, duplicate, failed: toRetry.length };
}
