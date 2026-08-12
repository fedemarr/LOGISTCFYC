import * as React from "react";
import type { Session } from "@supabase/supabase-js";
import { createSupabaseClient } from "../lib/supabase";

interface SessionContextValue {
  session: Session | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

/**
 * Sesión de Supabase para toda la app — patrón `useSession()` recomendado
 * por Expo Router para gatear rutas con `Stack.Protected` (ver
 * `app/_layout.tsx`). Se suscribe a `onAuthStateChange` una sola vez acá
 * arriba; el resto de la app solo lee `session`, nunca llama a Supabase
 * Auth directo.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const supabase = createSupabaseClient();
    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setIsLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return;
      setSession(next);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signIn = React.useCallback(async (email: string, password: string) => {
    const supabase = createSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signOut = React.useCallback(async () => {
    await createSupabaseClient().auth.signOut();
  }, []);

  const value = React.useMemo(
    () => ({ session, isLoading, signIn, signOut }),
    [session, isLoading, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession debe usarse dentro de <SessionProvider/>");
  return ctx;
}
