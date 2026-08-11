/**
 * Máquina de estados del paquete — PROMPT-MAESTRO §4.
 *
 * "Toda transición se ejecuta EXCLUSIVAMENTE a través de este servicio.
 * Ningún módulo puede hacer un UPDATE packages SET status = ... directo."
 *
 * Este package es agnóstico de base de datos a propósito: `transition()`
 * recibe los `TransitionDeps` (leer el estado actual, aplicar el cambio)
 * por inyección de dependencias. `apps/web` es quien conecta esas deps a
 * Drizzle/Postgres dentro de una transacción real (ver
 * `apps/web/src/lib/services/state-machine.ts`, FASE 3). Así:
 *  - Este package se testea 100% sin base de datos.
 *  - `apps/mobile` puede importar `validateTransition()`/`getLegalTransitions()`
 *    para decidir qué botones mostrar, sin arrastrar un driver de Postgres.
 */
import type { Role } from "@fyc/shared";
import {
  ForbiddenTransitionError,
  IllegalTransitionError,
  PreconditionFailedError,
} from "./errors";
import { findTransitionRule, getLegalTransitions, TRANSITIONS } from "./transitions";
import {
  EXCEPTION_STATUSES,
  FINAL_STATUSES,
  isFinalStatus,
  PACKAGE_STATUSES,
  type PackageStatus,
} from "./statuses";
import type { TransitionMetadata } from "./preconditions";

export { EXCEPTION_STATUSES, FINAL_STATUSES, isFinalStatus, PACKAGE_STATUSES };
export type { PackageStatus };
export { ForbiddenTransitionError, IllegalTransitionError, PreconditionFailedError };
export { findTransitionRule, getLegalTransitions, TRANSITIONS };
export type { TransitionRule } from "./transitions";
export type { TransitionMetadata } from "./preconditions";

export interface TransitionRequest {
  packageId: string;
  toStatus: PackageStatus;
  actorId: string;
  /** Un usuario puede tener varios roles a la vez (§3). */
  actorRoles: readonly Role[];
  metadata?: TransitionMetadata;
}

export interface TransitionResult {
  packageId: string;
  fromStatus: PackageStatus;
  toStatus: PackageStatus;
  eventId: string;
}

export interface TransitionDeps {
  /** Lee el estado actual del paquete (dentro de la transacción, con lock). */
  getCurrentStatus(packageId: string): Promise<PackageStatus>;
  /**
   * Aplica el UPDATE de `packages.status` y el INSERT en `events` en la
   * MISMA transacción (§4: "si el evento no se puede escribir, la
   * transición se revierte"). Devuelve el id del evento escrito.
   */
  applyTransition(params: {
    packageId: string;
    fromStatus: PackageStatus;
    toStatus: PackageStatus;
    actorId: string;
    actorRoles: readonly Role[];
    metadata: TransitionMetadata;
  }): Promise<{ eventId: string }>;
}

/**
 * Valida una transición sin ejecutarla — pura, sin I/O. Útil para decidir
 * en la UI (web o mobile) si mostrar una acción, y es lo que usa
 * `transition()` internamente.
 */
export function validateTransition(
  from: PackageStatus,
  to: PackageStatus,
  actorRoles: readonly Role[],
  metadata: TransitionMetadata = {},
):
  | { ok: true }
  | {
      ok: false;
      error: IllegalTransitionError | ForbiddenTransitionError | PreconditionFailedError;
    } {
  const rule = findTransitionRule(from, to);
  if (!rule) {
    return { ok: false, error: new IllegalTransitionError(from, to) };
  }
  if (!rule.allowedRoles.some((role) => actorRoles.includes(role))) {
    return { ok: false, error: new ForbiddenTransitionError(from, to, actorRoles) };
  }
  if (rule.precondition) {
    const failure = rule.precondition(metadata);
    if (failure) {
      return { ok: false, error: new PreconditionFailedError(from, to, failure) };
    }
  }
  return { ok: true };
}

/**
 * Punto único de escritura de estado (§4). Valida, y si es legal, delega en
 * `deps.applyTransition()` la escritura real (UPDATE + evento, transaccional).
 */
export async function transition(
  request: TransitionRequest,
  deps: TransitionDeps,
): Promise<TransitionResult> {
  const fromStatus = await deps.getCurrentStatus(request.packageId);
  const metadata = request.metadata ?? {};

  const validation = validateTransition(
    fromStatus,
    request.toStatus,
    request.actorRoles,
    metadata,
  );
  if (!validation.ok) {
    throw validation.error;
  }

  const { eventId } = await deps.applyTransition({
    packageId: request.packageId,
    fromStatus,
    toStatus: request.toStatus,
    actorId: request.actorId,
    actorRoles: request.actorRoles,
    metadata,
  });

  return {
    packageId: request.packageId,
    fromStatus,
    toStatus: request.toStatus,
    eventId,
  };
}
