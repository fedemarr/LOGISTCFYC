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

/**
 * Llama a la API y devuelve `data` (o tira `ApiClientError` si falla).
 *
 * El envelope real es `{ success, data, meta? }` con `meta` como HERMANO
 * de `data`, no anidado adentro (ver `lib/api/response.ts`). Pero el
 * contrato que consumen las páginas de listado es `Page<T> = { items,
 * meta }` — `meta` DENTRO del objeto. Por eso, si la respuesta trae
 * `meta` y `data` es un objeto, se fusionan acá antes de devolver: es el
 * único lugar del cliente que conoce el shape crudo del envelope, así
 * cada página no tiene que hacerlo por separado. Sin esto, `list.data`
 * quedaba como `{ items }` sin `meta`, y cualquier acceso a
 * `list.data.meta.total` tiraba `TypeError` en cuanto la pantalla
 * cargaba — bug real que estuvo así desde FASE 4 sin que nada lo
 * detectara (no hay verificación en navegador real en este proyecto).
 */
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

// ── Ingesta (FASE 5) ─────────────────────────────────────────────────────

export type OperationStatus = "OPEN" | "CLOSED";

export interface OperationItem {
  id: string;
  operationDate: string;
  status: OperationStatus;
  expectedCount: number;
  receivedCount: number;
  notes: string | null;
  createdAt: string;
}

export type DestinationSource =
  "MANIFEST" | "BARCODE_PAYLOAD" | "OCR" | "MANUAL" | "ADDRESS_MEMORY";
export type DestinationConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface ScanOutcomeResponse {
  packageId: string;
  internalCode: string;
  trackingCode: string;
  status: string;
  resolution: {
    resolved: boolean;
    source: DestinationSource;
    confidence: DestinationConfidence;
  };
  duplicate: boolean;
  duplicateInfo?: { scannedBy: string; scannedAt: string };
  wrongClient: boolean;
}

export interface PendingPackageItem {
  id: string;
  internalCode: string;
  trackingCode: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  rawAddressText: string | null;
  labelPhotoUrl: string | null;
  createdAt: string;
}

export interface ImportSummary {
  created: number;
  skipped: number;
  total: number;
}

export interface GeocodeSummary {
  processed: number;
  geocoded: number;
  failed: number;
}

export interface ReconciliationItem {
  trackingCode: string | null;
  internalCode: string;
}

export interface CloseOperationResponse {
  operation: OperationItem;
  reconciliation: {
    expected: number;
    received: number;
    missing: ReconciliationItem[];
    surplus: ReconciliationItem[];
  };
}

// ── Ruteo (FASE 6) ──────────────────────────────────────────────────────

export type RouteStatus =
  | "DRAFT"
  | "PROPOSED"
  | "APPROVED"
  | "ASSIGNED"
  | "LOADING"
  | "LOADED"
  | "IN_TRANSIT"
  | "COMPLETED"
  | "CANCELLED";

export interface RouteItem {
  id: string;
  operationId: string;
  routeNumber: number;
  status: RouteStatus;
  assignedDriverId: string | null;
  vehicleId: string | null;
  containerId: string | null;
  plannedDistanceM: number | null;
  plannedDurationS: number | null;
  plannedStops: number | null;
  colorHex: string | null;
  stopCount: number;
  driverName: string | null;
  vehiclePlate: string | null;
  capacityPackages: number | null;
  containerCode: string | null;
}

export interface GenerateRouteProposalResponse {
  routes: Array<{
    routeId: string;
    routeNumber: number;
    packageCount: number;
    plannedDistanceM: number;
    plannedDurationS: number;
  }>;
  outlierPackageIds: string[];
  unassignedForLackOfCapacity: number;
}

export interface RouteStopItem {
  stopId: string;
  sequence: number;
  status: string;
  distanceFromPrevM: number | null;
  durationFromPrevS: number | null;
  packageId: string;
  internalCode: string;
  trackingCode: string | null;
  bulkNumber: number | null;
  recipientName: string | null;
  rawAddressText: string | null;
  lat: number | null;
  lng: number | null;
}

export interface RouteDetail extends RouteItem {
  driverName: string | null;
  stops: RouteStopItem[];
}

export interface ApproveRouteResponse {
  routeId: string;
  status: "APPROVED";
  packageCount: number;
}

// ── Monitoreo y bandeja (FASE 11) ───────────────────────────────────────

export type LiveAlertType = "GPS_SILENCE" | "STOPPED" | "BEHIND_SCHEDULE";

export interface LiveAlert {
  type: LiveAlertType;
  message: string;
  sinceMin: number;
}

export interface LiveRouteItem {
  routeId: string;
  routeNumber: number;
  startedAt: string | null;
  driverId: string;
  driverName: string;
  plate: string | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  isMoving: boolean | null;
  speedMps: number | null;
  batteryLevel: number | null;
  lastPingMinAgo: number | null;
  receivedAt: string | null;
  alerts: LiveAlert[];
}

export interface TrackingPoint {
  id: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedMps: number | null;
  batteryLevel: number | null;
  isMoving: boolean | null;
  recordedAt: string;
  receivedAt: string;
}

export interface InboxIncident {
  incidentId: string;
  reason: string;
  description: string | null;
  photoUrls: string[];
  lat: number | null;
  lng: number | null;
  createdAt: string;
  slaOverdueS: number | null;
  packageId: string | null;
  internalCode: string | null;
  routeId: string | null;
  routeNumber: number | null;
  driverName: string | null;
}

export interface InboxReviewDelivery {
  deliveryId: string;
  packageId: string | null;
  internalCode: string | null;
  receiverName: string | null;
  distanceFromTargetM: number | null;
  lat: number | null;
  lng: number | null;
  deliveredAt: string;
  driverName: string | null;
  routeNumber: number | null;
}

export interface InboxCustodyDiscrepancy {
  custodyId: string;
  routeId: string;
  routeNumber: number | null;
  expectedCount: number;
  countedCount: number | null;
  method: string;
  discrepancyNotes: string | null;
  createdAt: string;
  driverName: string | null;
}

export interface DispatchInbox {
  incidents: InboxIncident[];
  reviewDeliveries: InboxReviewDelivery[];
  custodyDiscrepancies: InboxCustodyDiscrepancy[];
}
