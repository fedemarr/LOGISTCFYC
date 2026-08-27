/**
 * Cliente HTTP de la PWA del chofer. A diferencia del panel (que usa JWT de
 * Supabase), acá la identidad es el token del QR: se manda como
 * `Authorization: Bearer <token>`. El middleware de `/api/chofer/*` lo deja
 * pasar (no exige Supabase) y el server valida el hash contra
 * `users.qr_token_hash`.
 */

const STORAGE_KEY = "fym-driver-token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function storeToken(token: string): void {
  window.localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

export class DriverApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "DriverApiError";
    this.code = code;
    this.status = status;
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export async function driverApi<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");

  const res = await fetch(path, { ...init, headers });

  let json: Envelope<T>;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    throw new DriverApiError("NETWORK_ERROR", "respuesta no JSON", res.status);
  }

  if (!res.ok || json.success === false) {
    throw new DriverApiError(
      json.error?.code ?? "HTTP_ERROR",
      json.error?.message ?? `HTTP ${res.status}`,
      res.status,
    );
  }
  return json.data as T;
}
