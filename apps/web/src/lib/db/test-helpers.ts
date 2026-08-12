import { sql } from "drizzle-orm";
import { db } from "./index";

/**
 * Borra los `events` de una org de test al cerrar un test suite.
 *
 * `events` es append-only DE VERDAD (trigger `forbid_events_mutation`,
 * ver `supabase/migrations/0001_...sql`) — ni siquiera la conexión de
 * administración puede hacer un DELETE normal. Para limpiar datos de test
 * hace falta saltarse los triggers, pero **`ALTER TABLE ... DISABLE
 * TRIGGER` es global a nivel Postgres** (afecta a todas las conexiones,
 * no solo a la que lo ejecuta) — con Vitest corriendo varios archivos de
 * test en paralelo contra la misma base, esa ventana de "trigger
 * deshabilitado" puede coincidir con el test de otro archivo que
 * justamente está verificando que el DELETE esté bloqueado, y lo ve pasar
 * (falso negativo intermitente).
 *
 * La forma segura: `SET LOCAL session_replication_role = replica` DENTRO
 * de una transacción. Es una GUC de sesión que le dice a Postgres "no
 * dispares triggers normales" — pero `LOCAL` la limita a la transacción
 * actual, en la conexión que Drizzle reserva para ella, y se revierte
 * sola al hacer COMMIT. Ninguna otra conexión del pool la ve nunca.
 */
export async function purgeTestEvents(orgId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`);
  });
}
