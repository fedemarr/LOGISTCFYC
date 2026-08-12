import type { Role } from "@fyc/shared";
import { createSupabaseClient } from "@/lib/supabase/client";

/**
 * Cliente HTTP del panel (FASE 4). Envuelve `fetch` contra la API de
 * `apps/web/src/app/api/*` con el shape estándar del sistema
 * (`{ success, data, meta }` / `{ success, error: { code, message } }`,
 * ver docs/API.md) y adjunta el token de sesión de Supabase como
 * `Authorization: Bearer`. El middleware de `/api/*` valida ese JWT.
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
  meta?: PaginationMeta;
  error?: { code: string; message: string; details?: unknown };
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

export interface Page<T> {
  items: T[];
  meta: PaginationMeta;
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await createSupabaseClient().auth.getSession();
  return data.session?.access_token ?? null;
}

/** Llama a la API y devuelve `data` (o tira `ApiClientError` si falla). */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const token = await getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");

  const res = await fetch(path, { ...init, headers });

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

  return json.data as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

// ── Tipos de la respuesta de la API (espejo de los schemas del server) ──

export interface MeResponse {
  user: {
    id: string;
    email: string;
    fullName: string;
    phone: string | null;
    roles: Role[];
  };
  orgName: string | null;
}

export interface UserItem {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  roles: Role[];
  createdAt: string;
}

export interface VehicleItem {
  id: string;
  plate: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  capacityPackages: number | null;
  status: VehicleStatus;
  assignedDriverId: string | null;
  assignedDriverName: string | null;
  createdAt: string;
}

export type VehicleStatus = "AVAILABLE" | "IN_ROUTE" | "MAINTENANCE" | "OUT_OF_SERVICE";

export interface ClientItem {
  id: string;
  name: string;
  contact: string | null;
  isActive: boolean;
  createdAt: string;
}

export type ContainerType = "BAG" | "CART" | "CAGE" | "SHELF";

export interface ContainerItem {
  id: string;
  code: string;
  qrPayload: string | null;
  type: ContainerType;
  isActive: boolean;
  createdAt: string;
}
