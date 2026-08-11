import { errorToBody, type AppError } from "./errors";

/**
 * Envoltorio de respuesta estándar (PROMPT-MAESTRO §14 FASE 3):
 * - éxito: `{ success: true, data, meta? }`
 * - error: `{ success: false, error: { code, message, details? } }`
 *
 * `meta` lleva lo que no es el recurso en sí: paginación, timestamps,
 * versiones. El shape es idéntico para todos los endpoints del sistema.
 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export function ok<T>(data: T, meta?: Record<string, unknown>): ApiSuccess<T> {
  return meta ? { success: true, data, meta } : { success: true, data };
}

export function fail(err: AppError): ApiFailure {
  return { success: false, error: errorToBody(err) };
}

export function jsonOk<T>(
  data: T,
  meta?: Record<string, unknown>,
  init?: ResponseInit,
): Response {
  return Response.json(ok(data, meta), { status: init?.status ?? 200, ...init });
}

export function jsonError(err: AppError): Response {
  return Response.json(fail(err), { status: err.httpStatus });
}

/** Meta estándar de paginación offset — `{ page, pageSize, total, pages }`. */
export function paginationMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
}
