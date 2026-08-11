import {
  ForbiddenTransitionError,
  IllegalTransitionError,
  PreconditionFailedError,
} from "@fyc/state-machine";

/**
 * Error de dominio del backend — respuesta estándar del sistema
 * (PROMPT-MAESTRO §14 FASE 3): `{ success, error: { code, message } }`.
 * Todos los errores que llegan al borde HTTP se normalizan a `AppError`
 * (ver `toAppError`), así ningún Route Handler maneja excepciones crudas.
 */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PRECONDITION_FAILED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "ILLEGAL_TRANSITION"
  | "FORBIDDEN_TRANSITION";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, httpStatus: number, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

/** Constructores de los errores más comunes — código de negocio -> AppError. */
export const Errors = {
  validation(message: string, details?: unknown): AppError {
    return new AppError("VALIDATION_ERROR", message, 400, details);
  },
  unauthorized(message = "no autenticado"): AppError {
    return new AppError("UNAUTHORIZED", message, 401);
  },
  forbidden(message = "no tenés permiso para esta acción"): AppError {
    return new AppError("FORBIDDEN", message, 403);
  },
  notFound(message = "no encontrado"): AppError {
    return new AppError("NOT_FOUND", message, 404);
  },
  conflict(message: string): AppError {
    return new AppError("CONFLICT", message, 409);
  },
  preconditionFailed(message: string, details?: unknown): AppError {
    return new AppError("PRECONDITION_FAILED", message, 422, details);
  },
  rateLimited(message = "demasiadas requests, intentá de nuevo en un minuto"): AppError {
    return new AppError("RATE_LIMITED", message, 429);
  },
  internal(message = "error interno del servidor"): AppError {
    return new AppError("INTERNAL_ERROR", message, 500);
  },
};

function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Normaliza cualquier excepción a un `AppError`. Los errores del dominio
 * (máquina de estados) se mapean a códigos con su HTTP status; todo lo
 * desconocido cae en INTERNAL_ERROR (500) para no filtrar detalles de
 * implementación al cliente. El logging del detalle real lo hace el
 * handler, no acá.
 */
export function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;
  if (err instanceof IllegalTransitionError) {
    return new AppError("ILLEGAL_TRANSITION", err.message, 409);
  }
  if (err instanceof ForbiddenTransitionError) {
    return new AppError("FORBIDDEN_TRANSITION", err.message, 403);
  }
  if (err instanceof PreconditionFailedError) {
    return new AppError("PRECONDITION_FAILED", err.message, 422);
  }
  return Errors.internal();
}

/** Saca la información que sí es segura para exponer por HTTP. */
export function errorToBody(err: AppError): {
  code: ErrorCode;
  message: string;
  details?: unknown;
} {
  return {
    code: err.code,
    message: err.message,
    ...(err.details ? { details: err.details } : {}),
  };
}
