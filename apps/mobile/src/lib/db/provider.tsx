import type { SQLiteDatabase } from "expo-sqlite";
import { SQLiteProvider } from "expo-sqlite";
import type { ReactNode } from "react";
import { DB_NAME, SCHEMA_SQL } from "./schema";

/**
 * Migración idempotente: primero el `CREATE TABLE IF NOT EXISTS` (crea las
 * tablas nuevas y no toca las existentes), y después los `ALTER TABLE` de
 * columnas agregadas en fases posteriores, que en SQLite NO se pueden
 * declarar en un CREATE ya existente (un `CREATE TABLE IF NOT EXISTS` con
 * columnas nuevas no las agrega). Cada ALTER se intenta y se ignora el
 * error "duplicate column name" — si la columna ya está, no hay nada que
 * hacer.
 */
async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(SCHEMA_SQL);

  const alters: string[] = [
    // FASE 10: marca de "ya se encoló STOP_ARRIVED" para no duplicar llegadas.
    `ALTER TABLE local_stop ADD COLUMN arrived_sent INTEGER NOT NULL DEFAULT 0`,
  ];

  for (const alter of alters) {
    try {
      await db.execAsync(alter);
    } catch {
      // duplicate column name — ya migrada, ignorar.
    }
  }
}

/**
 * Envuelve la app entera — `useSQLiteContext()` en cualquier pantalla/
 * hook de acá para abajo da la misma conexión ya migrada. `onInit` corre
 * una sola vez por apertura de base (expo-sqlite lo garantiza).
 */
export function LocalDbProvider({ children }: { children: ReactNode }) {
  return (
    <SQLiteProvider databaseName={DB_NAME} onInit={migrate}>
      {children}
    </SQLiteProvider>
  );
}
