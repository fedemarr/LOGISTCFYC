import type { ZodType } from "zod";
import { Errors } from "./errors";

/**
 * Validación Zod de TODOS los inputs (PROMPT-MAESTRO §14 FASE 3: "Zod para
 * validación de todos los inputs"). Cada helper parsea y, si falla, tira un
 * `AppError` VALIDATION_ERROR con el detalle aplanado de Zod — los Route
 * Handlers no tienen que repetir la rama de error.
 */

type ParamsLike = Record<string, string | string[] | undefined>;

function validate<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw Errors.validation("input inválido", result.error.flatten());
  }
  return result.data;
}

/** Valida el body JSON de la request. Falla con 400 si no es JSON o no matchea. */
export async function parseBody<T>(schema: ZodType<T>, request: Request): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw Errors.validation("el body no es JSON válido");
  }
  return validate(schema, raw);
}

/** Valida la query string. Se construye con `new URL(request.url)`. */
export function parseQuery<T>(schema: ZodType<T>, url: URL): T {
  return validate(schema, Object.fromEntries(url.searchParams.entries()));
}

/**
 * Valida los segmentos dinámicos de la ruta. En Next.js 15 `params` llega
 * como una Promise — se await acá para que los handlers no lo hagan.
 */
export async function parseParams<T>(
  schema: ZodType<T>,
  params: Promise<ParamsLike>,
): Promise<T> {
  const resolved = await params;
  return validate(schema, resolved);
}

export interface PaginationInput {
  page?: number;
  pageSize?: number;
}

/** Paginación offset estándar de todos los endpoints de lista. */
export function paginationFrom(query: PaginationInput): {
  page: number;
  pageSize: number;
  offset: number;
} {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 20)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
