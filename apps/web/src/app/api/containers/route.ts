import { and, count, desc, eq, isNull, like, or } from "drizzle-orm";
import { z } from "zod";
import {
  consumeRateLimit,
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
import { containers } from "@/lib/db/schema";

/**
 * GET /api/containers — bolsas/carros/jaulas físicos. Lectura:
 * admin/dispatcher/warehouse; escritura: solo admin (FASE 4 — CRUD).
 */
const listSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  type: z.enum(["BAG", "CART", "CAGE", "SHELF"]).optional(),
});

const createSchema = z.object({
  code: z.string().trim().min(1, "el código es obligatorio").max(50),
  qrPayload: z.string().trim().max(200).optional().nullable(),
  type: z.enum(["BAG", "CART", "CAGE", "SHELF"]),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const url = new URL(request.url);
    const query = parseQuery(listSchema, url);
    const { page, pageSize, offset } = paginationFrom(query);

    const conditions = [eq(containers.orgId, ctx.orgId), isNull(containers.deletedAt)];
    if (query.search) {
      const likeCond = or(
        like(containers.code, `%${query.search}%`),
        like(containers.qrPayload, `%${query.search}%`),
      );
      if (likeCond) conditions.push(likeCond);
    }
    if (query.type) conditions.push(eq(containers.type, query.type));

    const where = and(...conditions);

    const [totalRow] = await db.select({ n: count() }).from(containers).where(where);
    const total = totalRow?.n ?? 0;

    const rows = await db
      .select({
        id: containers.id,
        code: containers.code,
        qrPayload: containers.qrPayload,
        type: containers.type,
        isActive: containers.isActive,
        createdAt: containers.createdAt,
      })
      .from(containers)
      .where(where)
      .orderBy(desc(containers.createdAt))
      .limit(pageSize)
      .offset(offset);

    return jsonOk({ items: rows }, paginationMeta(page, pageSize, total));
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin"]);
    const body = await parseBody(createSchema, request);

    await consumeRateLimit(`containers:write:${ctx.userId}`, {
      limit: 60,
      windowSeconds: 60,
    });

    const [row] = await db
      .insert(containers)
      .values({
        orgId: ctx.orgId,
        code: body.code.toUpperCase(),
        qrPayload: body.qrPayload,
        type: body.type,
      })
      .returning({ id: containers.id, code: containers.code });

    return jsonOk(row, undefined, { status: 201 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
