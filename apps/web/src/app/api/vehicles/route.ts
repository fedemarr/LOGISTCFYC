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
import { users, vehicles } from "@/lib/db/schema";

/**
 * GET /api/vehicles — listado de vehículos. Lectura: admin/dispatcher/
 * warehouse (matriz §3 "Ver todo"); escritura: solo admin.
 * POST /api/vehicles — alta de vehículo (admin).
 */
const listSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["AVAILABLE", "IN_ROUTE", "MAINTENANCE", "OUT_OF_SERVICE"]).optional(),
});

const createSchema = z.object({
  plate: z.string().trim().min(1, "la patente es obligatoria").max(20),
  brand: z.string().trim().max(50).optional().nullable(),
  model: z.string().trim().max(50).optional().nullable(),
  year: z.coerce.number().int().min(1950).max(2100).optional().nullable(),
  capacityPackages: z.coerce.number().int().min(1).max(10000).optional().nullable(),
  capacityM3: z.coerce.number().positive().optional().nullable(),
  capacityKg: z.coerce.number().positive().optional().nullable(),
  status: z.enum(["AVAILABLE", "IN_ROUTE", "MAINTENANCE", "OUT_OF_SERVICE"]).optional(),
  currentOdometer: z.coerce.number().int().min(0).optional().nullable(),
  insuranceExpiry: z.string().date("fecha inválida").optional().nullable(),
  vtvExpiry: z.string().date("fecha inválida").optional().nullable(),
  assignedDriverId: z.string().uuid("chofer inválido").optional().nullable(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const url = new URL(request.url);
    const query = parseQuery(listSchema, url);
    const { page, pageSize, offset } = paginationFrom(query);

    const conditions = [eq(vehicles.orgId, ctx.orgId), isNull(vehicles.deletedAt)];
    if (query.search) {
      const likeCond = or(
        like(vehicles.plate, `%${query.search}%`),
        like(vehicles.brand, `%${query.search}%`),
        like(vehicles.model, `%${query.search}%`),
      );
      if (likeCond) conditions.push(likeCond);
    }
    if (query.status) conditions.push(eq(vehicles.status, query.status));

    const where = and(...conditions);

    const [totalRow] = await db.select({ n: count() }).from(vehicles).where(where);
    const total = totalRow?.n ?? 0;

    const rows = await db
      .select({
        id: vehicles.id,
        plate: vehicles.plate,
        brand: vehicles.brand,
        model: vehicles.model,
        year: vehicles.year,
        capacityPackages: vehicles.capacityPackages,
        status: vehicles.status,
        assignedDriverId: vehicles.assignedDriverId,
        assignedDriverName: users.fullName,
        createdAt: vehicles.createdAt,
      })
      .from(vehicles)
      .leftJoin(users, eq(users.id, vehicles.assignedDriverId))
      .where(where)
      .orderBy(desc(vehicles.createdAt))
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

    await consumeRateLimit(`vehicles:write:${ctx.userId}`, {
      limit: 60,
      windowSeconds: 60,
    });

    const [row] = await db
      .insert(vehicles)
      .values({
        orgId: ctx.orgId,
        plate: body.plate.toUpperCase(),
        brand: body.brand,
        model: body.model,
        year: body.year,
        capacityPackages: body.capacityPackages,
        capacityM3: body.capacityM3,
        capacityKg: body.capacityKg,
        status: body.status,
        currentOdometer: body.currentOdometer,
        insuranceExpiry: body.insuranceExpiry,
        vtvExpiry: body.vtvExpiry,
        assignedDriverId: body.assignedDriverId,
      })
      .returning({ id: vehicles.id, plate: vehicles.plate });

    return jsonOk(row, undefined, { status: 201 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
