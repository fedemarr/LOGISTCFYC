import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import {
  Errors,
  jsonError,
  jsonOk,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { db } from "@/lib/db";
import { operations, packages } from "@/lib/db/schema";

const paramsSchema = z.object({ id: z.string().uuid("id de operación inválido") });

/** GET /api/operations/:id — detalle + conteo de paquetes por estado (§9.1). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id } = await parseParams(paramsSchema, params);

    const [operation] = await db
      .select()
      .from(operations)
      .where(and(eq(operations.id, id), eq(operations.orgId, ctx.orgId)));
    if (!operation) throw Errors.notFound("operación no encontrada");

    const statusCounts = await db
      .select({ status: packages.status, n: count() })
      .from(packages)
      .where(and(eq(packages.operationId, id), eq(packages.orgId, ctx.orgId)))
      .groupBy(packages.status);

    return jsonOk({
      operation,
      packagesByStatus: Object.fromEntries(statusCounts.map((r) => [r.status, r.n])),
    });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
