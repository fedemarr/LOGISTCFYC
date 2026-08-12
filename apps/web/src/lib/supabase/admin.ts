import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase con SERVICE ROLE — solo para código de servidor
 * (crear/editar usuarios de auth, jobs). JAMÁS importar desde un Client
 * Component: expone la service role key.
 *
 * En el deploy de Vercel se necesita `SUPABASE_SERVICE_ROLE_KEY` (el seed
 * corre local con `.env`; el alta de usuarios del panel corre en el
 * servidor y la usa). Sin ella, el alta de usuarios devuelve 500 con
 * mensaje claro.
 */
export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY para admin de Supabase",
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
