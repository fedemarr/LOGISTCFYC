import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware de identidad (PROMPT-MAESTRO §14 FASE 3 — auth).
 *
 * Verifica la sesión de Supabase ANTES de que la request llegue a un Route
 * Handler. La autorización por rol NO se resuelve acá: este middleware corre
 * en el Edge runtime de Next (sin acceso a Postgres) — solo valida el JWT y
 * deja la identidad en el header `x-fym-user-id`, que `requireRole`/
 * `requireUser` (`apps/web/src/lib/api/auth.ts`) usan para cargar roles y
 * `org_id` desde la base. ADR-015: RLS no protege al backend, esto sí.
 *
 * El middleware SIEMPRE sobreescribe el header que pudiera mandar el
 * cliente, así no se puede impostar un `userId` ajeno.
 */
const USER_ID_HEADER = "x-fym-user-id";

function getBearerToken(request: NextRequest): string | null {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: { code: "UNAUTHORIZED", message: "sesión inválida o expirada" },
    },
    { status: 401 },
  );
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY para el middleware",
    );
  }
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  // Las rutas de la PWA del chofer (/api/chofer/*) se autentican con el QR
  // (`requireDriver`), no con sesión de Supabase — pasan directo. OJO:
  // tiene que ser un corte de segmento (`/api/chofer` o `/api/chofer/…`),
  // NO un simple `startsWith` — "/api/choferes" (el endpoint del panel que
  // LISTA choferes, con sesión de Supabase normal) también empieza con la
  // string "/api/chofer" y quedaba colándose por acá sin el header
  // `x-fym-user-id`, tirando 401 siempre pese a estar bien logueado.
  const path = request.nextUrl.pathname;
  if (path === "/api/chofer" || path.startsWith("/api/chofer/")) {
    return NextResponse.next();
  }

  const token = getBearerToken(request);
  if (!token) return unauthorized();

  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return unauthorized();

  const headers = new Headers(request.headers);
  headers.delete(USER_ID_HEADER);
  headers.set(USER_ID_HEADER, data.user.id);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/api/:path*"],
};
