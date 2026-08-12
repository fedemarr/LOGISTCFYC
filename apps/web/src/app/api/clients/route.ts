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
import { clients } from "@/lib/db/schema";

/**
 * GET /api/clients — proveedores de paquetes. Lectura: admin/dispatcher/
 * warehouse; escritura: solo admin (FASE 4 — CRUD de clientes).
 */
const listSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1, "el nombre es obligatorio").max(200),
  contact: z.string().trim().max(200).optional().nullable(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const url = new URL(request.url);
    const query = parseQuery(listSchema, url);
    const { page, pageSize, offset } = paginationFrom(query);

    const conditions = [eq(clients.orgId, ctx.orgId), isNull(clients.deletedAt)];
    if (query.search) {
      const likeCond = or(
        like(clients.name, `%${query.search}%`),
        like(clients.contact, `%${query.search}%`),
      );
      if (likeCond) conditions.push(likeCond);
    }

    const where = and(...conditions);

    const [totalRow] = await db.select({ n: count() }).from(clients).where(where);
    const total = totalRow?.n ?? 0;

    const rows = await db
      .select({
        id: clients.id,
        name: clients.name,
        contact: clients.contact,
        isActive: clients.isActive,
        createdAt: clients.createdAt,
      })
      .from(clients)
      .where(where)
      .orderBy(desc(clients.createdAt))
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

    await consumeRateLimit(`clients:write:${ctx.userId}`, {
      limit: 60,
      windowSeconds: 60,
    });

    const [row] = await db
      .insert(clients)
      .values({ orgId: ctx.orgId, name: body.name, contact: body.contact })
      .returning({ id: clients.id, name: clients.name });

    return jsonOk(row, undefined, { status: 201 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
