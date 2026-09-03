/**
 * Cliente HTTP crudo de la API de Tienda Nube (Nuvemshop) — SOLO fetch +
 * mapeo de la respuesta a nuestros tipos, sin tocar la base ni depender
 * de nada del resto del sistema. Separado así a propósito para poder
 * mockear `fetch` en los tests sin arrastrar Drizzle/DB (mismo patrón que
 * `services/geocoding.ts`).
 *
 * Docs oficiales: https://tiendanube.github.io/api-documentation/intro
 * — base URL versionada por fecha (`/2025-03/...`), auth por
 * `Authorization: Bearer <token>` + `User-Agent` obligatorio (sin este
 * header, la API devuelve 400 directo).
 */

const API_VERSION = "2025-03";

/** Identifica la app ante Tienda Nube — pedido explícito de su doc: un
 * nombre + contacto. Cambiar el email si hace falta uno real de soporte. */
const USER_AGENT = "FYM Logistica (soporte@fym.app)";

export class TiendanubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "TiendanubeApiError";
  }
}

function baseUrl(storeId: string): string {
  return `https://api.tiendanube.com/${API_VERSION}/${storeId}`;
}

function headers(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
  };
}

async function request<T>(
  storeId: string,
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${baseUrl(storeId)}${path}`, {
    ...init,
    headers: { ...headers(accessToken), ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw new TiendanubeApiError(
      `Tienda Nube API ${response.status} en ${path}`,
      response.status,
      body,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ── Tipos de la respuesta de Tienda Nube (solo los campos que usamos) ──

export interface TiendanubeShippingAddress {
  address?: string | null;
  number?: string | null;
  floor?: string | null;
  locality?: string | null;
  city?: string | null;
  province?: string | null;
  zipcode?: string | null;
  country?: string | null;
  phone?: string | null;
}

export interface TiendanubeOrder {
  id: number;
  number: number;
  status: "open" | "closed" | "cancelled";
  payment_status: string;
  shipping_status: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  shipping_address?: TiendanubeShippingAddress | null;
  [key: string]: unknown;
}

export interface TiendanubeStore {
  id: number;
  name: Record<string, string> | string;
}

export interface TiendanubeFulfillmentOrder {
  id: string;
  status: "UNPACKED" | "IN_PREPARATION" | "PACKED" | "DISPATCHED" | "DELIVERED";
}

/** Valida el token/store_id llamando al endpoint del store — se usa al
 * conectar, para no guardar credenciales que no funcionan. */
export async function verifyConnection(
  storeId: string,
  accessToken: string,
): Promise<TiendanubeStore> {
  return request<TiendanubeStore>(storeId, accessToken, "/store");
}

/** Trae pedidos, más recientes primero. `updatedAtMin` para sync
 * incremental (solo lo que cambió desde la última corrida). */
export async function fetchOrders(
  storeId: string,
  accessToken: string,
  options: { updatedAtMin?: string; perPage?: number } = {},
): Promise<TiendanubeOrder[]> {
  const params = new URLSearchParams({
    per_page: String(options.perPage ?? 50),
  });
  if (options.updatedAtMin) params.set("updated_at_min", options.updatedAtMin);
  return request<TiendanubeOrder[]>(storeId, accessToken, `/orders?${params.toString()}`);
}

export async function fetchFulfillmentOrders(
  storeId: string,
  accessToken: string,
  orderId: string | number,
): Promise<TiendanubeFulfillmentOrder[]> {
  return request<TiendanubeFulfillmentOrder[]>(
    storeId,
    accessToken,
    `/orders/${orderId}/fulfillment-orders`,
  );
}

/** Marca el fulfillment order como DELIVERED (o el estado que se pida) —
 * esto es lo que Tienda Nube muestra como "entregado" en el pedido. */
export async function updateFulfillmentOrderStatus(
  storeId: string,
  accessToken: string,
  orderId: string | number,
  fulfillmentOrderId: string,
  status: TiendanubeFulfillmentOrder["status"],
): Promise<TiendanubeFulfillmentOrder> {
  return request<TiendanubeFulfillmentOrder>(
    storeId,
    accessToken,
    `/orders/${orderId}/fulfillment-orders/${fulfillmentOrderId}`,
    { method: "PATCH", body: JSON.stringify({ status }) },
  );
}
