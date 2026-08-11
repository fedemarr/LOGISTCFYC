import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no está definida (ver .env.example).");
}

export default defineConfig({
  schema: "./src/lib/db/schema/index.ts",
  // Las migraciones viven en la raíz del repo (supabase/migrations), no
  // dentro de apps/web — así conviven las generadas por drizzle-kit y las
  // escritas a mano (PostGIS, particionado, RLS). Ver docs/DECISIONES.md.
  out: "../../supabase/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
