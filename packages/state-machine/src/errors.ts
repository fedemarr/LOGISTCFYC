/** Se pidió una transición que no existe en el diagrama de §4. */
export class IllegalTransitionError extends Error {
  readonly code = "ILLEGAL_TRANSITION";
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Transición ilegal: ${from} → ${to} no está permitida.`);
    this.name = "IllegalTransitionError";
  }
}

/** La transición existe, pero el actor no tiene el rol necesario. */
export class ForbiddenTransitionError extends Error {
  readonly code = "FORBIDDEN_TRANSITION";
  constructor(
    readonly from: string,
    readonly to: string,
    readonly actorRoles: readonly string[],
  ) {
    super(
      `Transición ${from} → ${to} no permitida para los roles [${actorRoles.join(", ")}].`,
    );
    this.name = "ForbiddenTransitionError";
  }
}

/** La transición es legal para el rol, pero falta una precondición (§4). */
export class PreconditionFailedError extends Error {
  readonly code = "PRECONDITION_FAILED";
  constructor(
    readonly from: string,
    readonly to: string,
    reason: string,
  ) {
    super(`Transición ${from} → ${to} bloqueada: ${reason}`);
    this.name = "PreconditionFailedError";
  }
}
