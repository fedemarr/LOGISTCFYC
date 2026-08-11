/** Estados del paquete, en el orden del diagrama de PROMPT-MAESTRO §4. */
export const PACKAGE_STATUSES = [
  "PENDIENTE_RESOLUCION",
  "RECIBIDO",
  "GEOCODIFICADO",
  "ASIGNADO",
  "CARGADO",
  "EN_REPARTO",
  "EN_DOMICILIO",
  "ENTREGADO",
  "FALLA_REPORTADA",
  "REPROGRAMADO",
  "DEVUELTO",
  "EXTRAVIADO",
  "DANIADO",
  "CANCELADO",
] as const;

export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

/** Estados finales: irreversibles salvo reapertura explícita por `admin` (§4). */
export const FINAL_STATUSES: readonly PackageStatus[] = [
  "ENTREGADO",
  "DEVUELTO",
  "EXTRAVIADO",
  "CANCELADO",
] as const;

export function isFinalStatus(status: PackageStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

/**
 * Estados de excepción (§4): "desde casi cualquier estado, requieren
 * aprobación". `DANIADO` no es final en el diagrama — desde ahí Operaciones
 * todavía decide (entregar igual, devolver, reprogramar), igual que desde
 * `FALLA_REPORTADA`. Ver `EXCEPTION_RESOLUTION_TARGETS` en transitions.ts.
 */
export const EXCEPTION_STATUSES: readonly PackageStatus[] = [
  "EXTRAVIADO",
  "DANIADO",
  "CANCELADO",
] as const;
