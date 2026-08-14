import { createSupabaseClient } from "./supabase";

/**
 * Cliente HTTP contra la API de `apps/web` (mismo backend que el panel,
 * ver `apps/web/src/lib/api/client.ts`). Envelope estándar `{ success,
 * data, meta }` / `{ success, error }`, token de Supabase como
 * `Authorization: Bearer`.
 *
 * El merge de `meta` DENTRO de `data` es el mismo fix que se aplicó en
 * el cliente del panel web (ver docs/DECISIONES.md ADR-040) — es el
 * mismo bug si se omite acá: `Page<T>` esperando `{ items, meta }` pero
 * el servidor mandando `meta` como hermano de `data`, no adentro.
 */

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
}

function apiBaseUrl(): string {
  const base = process.env.EXPO_PUBLIC_API_URL;
  if (!base) {
    throw new Error(
      "Falta EXPO_PUBLIC_API_URL — configurala en .env o el perfil de EAS antes de usar la API.",
    );
  }
  return base.replace(/\/$/, "");
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await createSupabaseClient().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const token = await getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");

  const res = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers });

  let json: ApiEnvelope<T>;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiClientError(
      "NETWORK_ERROR",
      "respuesta no JSON del servidor",
      res.status,
    );
  }

  if (!res.ok || json.success === false) {
    throw new ApiClientError(
      json.error?.code ?? "HTTP_ERROR",
      json.error?.message ?? `HTTP ${res.status}`,
      res.status,
    );
  }

  if (json.meta !== undefined && typeof json.data === "object" && json.data !== null) {
    return { ...json.data, meta: json.meta } as T;
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  del: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "DELETE",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
};
