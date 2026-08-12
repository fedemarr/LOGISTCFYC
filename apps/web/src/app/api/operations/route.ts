import { and, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  consumeRateLimit,
  Errors,
  jsonError,
  jsonOk,
  paginationFrom,
  paginationMeta,
  parseBody,
  parseQuery,
  requireRole,
  toAppError,
} from "@/lib/api";
import { db } from "@/lib/db";
import { operations } from "@/lib/db/schema";

/** Postgres unique_violation (23505) → 409 en vez del 500 genérico. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: string }).code === "23505"
  );
}

/**
 * GET /api/operations — listado (admin/dispatcher toda la org; warehouse
 * solo las abiertas, §7 RLS mirror a nivel de app — ver ADR-015).
 * POST /api/operations — crea la operación del día (§9.1 paso 1).
 */
const listSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(["OPEN", "CLOSED"]).optional(),
});

const createSchema = z.object({
  operationDate: z.string().date("fecha inválida"),
  expectedCount: z.coerce.number().int().min(0).optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const url = new URL(request.url);
    const query = parseQuery(listSchema, url);
    const { page, pageSize, offset } = paginationFrom(query);

    const conditions = [eq(operations.orgId, ctx.orgId), isNull(operations.deletedAt)];
    const isStaffFull = ctx.roles.some((r) => r === "admin" || r === "dispatcher");
    if (!isStaffFull) conditions.push(eq(operations.status, "OPEN"));
    if (query.status) conditions.push(eq(operations.status, query.status));

    const where = and(...conditions);
    const [totalRow] = await db.select({ n: count() }).from(operations).where(where);
    const total = totalRow?.n ?? 0;

    const rows = await db
      .select()
      .from(operations)
      .where(where)
      .orderBy(desc(operations.operationDate))
      .limit(pageSize)
      .offset(offset);

    return jsonOk({ items: rows }, paginationMeta(page, pageSize, total));
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const body = await parseBody(createSchema, request);

    await consumeRateLimit(`operations:write:${ctx.userId}`, {
      limit: 30,
      windowSeconds: 60,
    });

    try {
      const [row] = await db
        .insert(operations)
        .values({
          orgId: ctx.orgId,
          operationDate: body.operationDate,
          expectedCount: body.expectedCount ?? 0,
          notes: body.notes,
          createdBy: ctx.userId,
        })
        .returning();

      return jsonOk(row, undefined, { status: 201 });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw Errors.conflict(`ya existe una operación para ${body.operationDate}`);
      }
      throw err;
    }
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
