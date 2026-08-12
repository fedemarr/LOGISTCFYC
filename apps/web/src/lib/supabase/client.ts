import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Cliente Supabase del browser (Client Components). La sesión se persiste
 * en localStorage (default de supabase-js en el browser) y el app shell la
 * usa para redirigir a /login y para el header `Authorization: Bearer` de
 * `apiFetch` (FASE 4 — login y gestión de sesión del panel).
 *
 * No importar desde código de servidor (Route Handlers): ahí se usa
 * `getSupabaseAdmin` (service role) o el middleware valida el JWT.
 */
export function createSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY en el client",
    );
  }
  if (!cached) {
    cached = createClient(url, anonKey);
  }
  return cached;
}
