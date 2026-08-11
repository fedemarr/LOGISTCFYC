/**
 * Corredor de migraciones — `pnpm db:migrate` (apps/web/package.json).
 *
 * No usa el migrator de Drizzle (`drizzle-orm/node-postgres/migrator`)
 * porque ese mecanismo depende del journal que genera `drizzle-kit
 * generate` (`meta/_journal.json`), y acá el schema real necesita SQL
 * escrito a mano además de lo generado (PostGIS, particionado, RLS — ver
 * docs/DECISIONES.md ADR-013/014). En cambio: aplica cada `*.sql` de
 * `supabase/migrations/` en orden de nombre de archivo, una sola vez,
 * trackeado en `_lastmile_migrations`. Simple y explícito.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "../../../../../supabase/migrations");

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL no está definida (ver .env.example).");
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No hay migraciones en", MIGRATIONS_DIR);
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public._lastmile_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const { rows: applied } = await client.query<{ filename: string }>(
      "SELECT filename FROM public._lastmile_migrations",
    );
    const appliedSet = new Set(applied.map((r) => r.filename));

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`⏭  ${file} (ya aplicada)`);
        continue;
      }

      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`▶  Aplicando ${file}...`);

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO public._lastmile_migrations (filename) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
        console.log(`✓  ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Falló ${file}: ${(err as Error).message}`, { cause: err });
      }
    }

    console.log("Migraciones al día.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
