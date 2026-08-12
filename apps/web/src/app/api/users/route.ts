import { and, count, eq, inArray, isNull, like, or } from "drizzle-orm";
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
import { userRoles, users } from "@/lib/db/schema";
import { createUser } from "@/lib/services/users";

/**
 * GET /api/users — listado de usuarios del panel (FASE 4). Solo admin
 * (matriz de permisos §3: "Alta de usuarios / roles / vehículos").
 *
 * POST /api/users — crea un usuario: auth de Supabase (service role) + fila
 * en `users` + sus roles. Requiere `SUPABASE_SERVICE_ROLE_KEY` (ver
 * docs/API.md — falta en Vercel hasta que se agregue la env var).
 */
const listSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  role: z.enum(["admin", "dispatcher", "warehouse", "driver"]).optional(),
});

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email("email inválido"),
  password: z.string().min(8, "la contraseña debe tener al menos 8 caracteres"),
  fullName: z.string().trim().min(1, "el nombre es obligatorio"),
  phone: z.string().trim().max(50).optional().nullable(),
  roles: z.array(z.enum(["admin", "dispatcher", "warehouse", "driver"])).min(1),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin"]);
    const url = new URL(request.url);
    const query = parseQuery(listSchema, url);
    const { page, pageSize, offset } = paginationFrom(query);

    const conditions = [eq(users.orgId, ctx.orgId), isNull(users.deletedAt)];
    if (query.search) {
      const likeCond = or(
        like(users.email, `%${query.search}%`),
        like(users.fullName, `%${query.search}%`),
      );
      if (likeCond) conditions.push(likeCond);
    }
    if (query.role) {
      const idsWithRole = db
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.role, query.role));
      conditions.push(inArray(users.id, idsWithRole));
    }

    const where = and(...conditions);

    const [totalRow] = await db.select({ n: count() }).from(users).where(where);
    const total = totalRow?.n ?? 0;

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(where)
      .orderBy(users.createdAt)
      .limit(pageSize)
      .offset(offset);

    const roleRows =
      rows.length === 0
        ? []
        : await db
            .select({ userId: userRoles.userId, role: userRoles.role })
            .from(userRoles)
            .where(
              inArray(
                userRoles.userId,
                rows.map((r) => r.id),
              ),
            );

    const rolesByUser = new Map<string, string[]>();
    for (const rr of roleRows) {
      const list = rolesByUser.get(rr.userId) ?? [];
      list.push(rr.role);
      rolesByUser.set(rr.userId, list);
    }

    return jsonOk(
      {
        items: rows.map((row) => ({
          ...row,
          roles: rolesByUser.get(row.id) ?? [],
        })),
      },
      paginationMeta(page, pageSize, total),
    );
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin"]);
    const body = await parseBody(createSchema, request);

    await consumeRateLimit(`users:write:${ctx.userId}`, {
      limit: 60,
      windowSeconds: 60,
    });

    const result = await createUser({
      orgId: ctx.orgId,
      email: body.email,
      password: body.password,
      fullName: body.fullName,
      phone: body.phone,
      roles: body.roles,
    });

    return jsonOk(result, undefined, { status: 201 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
