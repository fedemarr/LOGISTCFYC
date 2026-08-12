import type { SQLiteDatabase } from "expo-sqlite";
import { SQLiteProvider } from "expo-sqlite";
import type { ReactNode } from "react";
import { DB_NAME, SCHEMA_SQL } from "./schema";

async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(SCHEMA_SQL);
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
