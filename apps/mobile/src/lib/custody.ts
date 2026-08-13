import type { CodeFormat } from "@fyc/shared";
import { api } from "./api";

/**
 * Cliente de la API de custodia y carga (§9) — espejo de los tipos de
 * `apps/web/src/lib/services/custody.ts`. Mismo criterio que `db/routes.ts`
 * (ADR-014/ADR-041): el shape se espeja a mano en cada app, no se comparte
 * por `@fyc/shared` todavía — si empieza a desincronizarse de verdad, se
 * mueve.
 */

export interface CustodyStateResult {
  route: {
    id: string;
    routeNumber: number;
    status: string;
    plannedStops: number | null;
    colorHex: string | null;
    containerId: string | null;
  } | null;
  container: { id: string; code: string; type: string } | null;
  custody: {
    id: string;
    method: string;
    status: string;
    expectedCount: number;
    countedCount: number | null;
    discrepancyNotes: string | null;
    overrideReason: string | null;
    transferredAt: string;
  } | null;
  scannedCount: number;
  canStart: boolean;
}

export interface CustodyScanResult {
  match: "matched" | "wrong_route" | "extra";
  duplicate: boolean;
  package: {
    packageId: string;
    internalCode: string;
    bulkNumber: number | null;
    sequence: number | null;
  } | null;
  otherRouteNumber?: number;
  scannedCount: number;
  expectedCount: number;
}

export interface CustodyFinishResult {
  status: "RESOLVED" | "DISCREPANCY";
  missing: { packageId: string; internalCode: string; bulkNumber: number | null }[];
  extra: { rawCode: string; otherRouteNumber: number | null }[];
}

export interface StartRouteResult {
  routeId: string;
  status: "IN_TRANSIT";
  startedAt: string;
  warnings: { batteryLow: boolean };
}

/** GET /api/driver/custody — estado actual del flujo de custodia del chofer. */
export async function getCustodyState(): Promise<CustodyStateResult> {
  return api.get<CustodyStateResult>("/api/driver/custody");
}

/** POST /api/driver/custody/start — paso 1: escaneo del QR del contenedor. */
export async function startCustody(input: {
  containerCode: string;
  lat?: number;
  lng?: number;
}): Promise<CustodyStateResult> {
  return api.post<CustodyStateResult>("/api/driver/custody/start", input);
}

/** POST /api/driver/custody/count — paso 2: conteo rápido de bultos. */
export async function submitCustodyCount(input: {
  routeId: string;
  countedCount: number;
  lat?: number;
  lng?: number;
}): Promise<CustodyStateResult> {
  return api.post<CustodyStateResult>("/api/driver/custody/count", input);
}

/** POST /api/driver/custody/scan — paso 3: escaneo individual ante diferencia. */
export async function scanPackageForCustody(input: {
  routeId: string;
  rawCode: string;
  codeFormat?: CodeFormat;
  deviceId?: string;
  lat?: number;
  lng?: number;
}): Promise<CustodyScanResult> {
  return api.post<CustodyScanResult>("/api/driver/custody/scan", input);
}

/** POST /api/driver/custody/finish — paso 4: cierra el escaneo individual. */
export async function finishFullScan(routeId: string): Promise<CustodyFinishResult> {
  return api.post<CustodyFinishResult>("/api/driver/custody/finish", { routeId });
}

/** POST /api/driver/route/start — paso 5: inicia la ruta (checklist §9.4). */
export async function startRoute(input: {
  routeId: string;
  gpsAccuracyM: number;
  lat?: number;
  lng?: number;
  batteryLevel?: number;
  batteryOptimizationDisabled: boolean;
  locationPermissionGranted: boolean;
  routeDownloaded: boolean;
}): Promise<StartRouteResult> {
  return api.post<StartRouteResult>("/api/driver/route/start", input);
}
