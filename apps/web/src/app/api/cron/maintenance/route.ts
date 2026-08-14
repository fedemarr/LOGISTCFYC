import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { Errors, jsonError, jsonOk } from "@/lib/api";

/**
 * GET /api/cron/maintenance — FASE 13: job de purga por política de
 * retención + mantenimiento de particiones (ver
 * `supabase/migrations/0010_maintenance_purge.sql`). NO es un endpoint de
 * negocio: corre `maintenance_purge()` contra la DB.
 *
 * Protegido por el header `x-cron-secret` (comparación a prueba de timing
 * con `crypto.subtle`). Configurar como cron en Vercel (vercel.json) o
 * cualquier scheduler con la URL del deploy.
 */
export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return jsonError(Errors.internal("CRON_SECRET no configurado"));
  }

  const provided = request.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, expected)) {
    return jsonError(Errors.unauthorized("secret inválido"));
  }

  try {
    await db.execute(sql`SELECT public.maintenance_purge()`);
    return jsonOk({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error de mantenimiento";
    return jsonError(Errors.internal(message));
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i]! ^ bufB[i]!;
  return diff === 0;
}
