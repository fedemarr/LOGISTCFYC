import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

/**
 * Cliente de Supabase Auth para la app del chofer — mismo proveedor que
 * el panel web, pero la persistencia de sesión usa `expo-secure-store`
 * (Keychain/Keystore) en vez de `localStorage` (que no existe en RN).
 *
 * ⚠️ `expo-secure-store` tiene un límite de ~2048 bytes por clave en
 * algunas plataformas — el objeto de sesión de Supabase normalmente
 * entra bien, pero si en el futuro empieza a fallar `setItemAsync` con
 * sesiones grandes (muchos scopes/metadata), hay que migrar a un
 * adapter que particione el valor en varias claves. No implementado en
 * FASE 7 porque no hay evidencia de que haga falta todavía.
 */
const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

let client: SupabaseClient | null = null;

/** Env vars públicas de Expo (`EXPO_PUBLIC_*`) — se inlinean en build time, ver app.config.ts / eas.json. */
export function createSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Faltan EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — configuralas en .env o el perfil de EAS antes de loguear.",
    );
  }

  client = createClient(url, anonKey, {
    auth: {
      storage: SecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
