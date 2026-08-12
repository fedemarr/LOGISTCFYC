import type { CodeFormat, ResolutionResult } from "@fyc/shared";
import { api } from "./api";

/** Espejo de `ScanOutcome` (`apps/web/src/lib/services/ingestion.ts`) — mismo criterio que `db/routes.ts`, ver ADR-014/ADR-041. */
export interface ScanOutcome {
  packageId: string;
  internalCode: string;
  trackingCode: string;
  status: string;
  resolution: ResolutionResult;
  duplicate: boolean;
  duplicateInfo?: { scannedBy: string; scannedAt: string };
  wrongClient: boolean;
}

export async function scanCode(
  operationId: string,
  input: { rawCode: string; codeFormat?: CodeFormat; deviceId?: string },
): Promise<ScanOutcome> {
  return api.post<ScanOutcome>(`/api/operations/${operationId}/scan`, input);
}

export async function resolvePackageManually(
  packageId: string,
  input: { rawAddressText: string; recipientName?: string; recipientPhone?: string },
): Promise<{ id: string; status: string }> {
  return api.post(`/api/packages/${packageId}/resolve`, input);
}

interface OperationSummary {
  id: string;
  operationDate: string;
  status: string;
}

/** La operación abierta del día — mismo criterio que `/deposito` del panel web. */
export async function getOpenOperation(): Promise<OperationSummary | null> {
  const page = await api.get<{ items: OperationSummary[] }>(
    "/api/operations?status=OPEN&pageSize=1",
  );
  return page.items[0] ?? null;
}
