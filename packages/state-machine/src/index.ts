/**
 * Máquina de estados del paquete — PROMPT-MAESTRO §4.
 *
 * FASE 1 solo deja el package scaffoldeado con el contrato de estados y la
 * firma del servicio. La implementación completa de `transition()`
 * (validación de transiciones legales, permisos por rol, precondiciones,
 * escritura transaccional en `events`) es alcance de FASE 3, una vez que
 * exista el modelo de datos (FASE 2) contra el que escribir.
 *
 * Regla que esta interfaz existe para hacer cumplir (PROMPT-MAESTRO §4):
 * "Toda transición se ejecuta EXCLUSIVAMENTE a través de este servicio.
 * Ningún módulo puede hacer un UPDATE packages SET status = ... directo."
 */

/** Estados del paquete, en el orden del diagrama de §4. */
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

/** Estados finales: irreversibles salvo reapertura explícita por `admin`. */
export const FINAL_STATUSES: readonly PackageStatus[] = [
  "ENTREGADO",
  "DEVUELTO",
  "EXTRAVIADO",
  "CANCELADO",
] as const;

export function isFinalStatus(status: PackageStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

export interface TransitionRequest {
  packageId: string;
  toStatus: PackageStatus;
  actorId: string;
  actorRole: string;
  metadata?: Record<string, unknown>;
}

export interface TransitionResult {
  packageId: string;
  fromStatus: PackageStatus;
  toStatus: PackageStatus;
  eventId: string;
}

/**
 * Punto único de escritura de estado. Implementación real: FASE 3.
 * @throws siempre en FASE 1 — placeholder intencional, no usar todavía.
 */
export async function transition(_request: TransitionRequest): Promise<TransitionResult> {
  throw new Error(
    "PackageStateMachine.transition() no está implementado todavía (FASE 3).",
  );
}
