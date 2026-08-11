import { PACKAGE_STATUSES } from "@lastmile/state-machine";
import { and, count, desc, eq, inArray, like, or } from "drizzle-orm";
import { z } from "zod";
import {
  jsonError,
  jsonOk,
  paginationFrom,
  paginationMeta,
  parseQuery,
  requireRole,
  toAppError,
} from "@/lib/api";
import { db } from "@/lib/db";
import { operations, packages, routes } from "@/lib/db/schema";

/**
 * GET /api/packages — listado con paginación y filtros. PATRÓN DE
 * REFERENCIA de un endpoint de lista (FASE 3): validación Zod de query,
 * scope por rol, paginación offset, respuesta estándar con `meta`.
 *
 * Scope según la matriz de permisos de PROMPT-MAESTRO §3:
 *   - admin/dispatcher: toda la organización
 *   - warehouse: solo la operación del día en curso
 *   - driver: solo paquetes de sus rutas asignadas
 *
 * Nunca expone `recipient_document_hash` ni `recipient_phone` en el listado.
 */
const querySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum([...PACKAGE_STATUSES]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  operationId: z.string().uuid("operationId inválido").optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, [
      "admin",
      "dispatcher",
      "warehouse",
      "driver",
    ]);
    const url = new URL(request.url);
    const query = parseQuery(querySchema, url);
    const { page, pageSize, offset } = paginationFrom(query);

    const conditions = [eq(packages.orgId, ctx.orgId)];

    const isStaff = ctx.roles.some((r) => r === "admin" || r === "dispatcher");
    if (!isStaff && ctx.roles.includes("warehouse")) {
      // "warehouse: solo del día" — la operación en curso es la de hoy.
      const today = new Date().toISOString().slice(0, 10);
      const todayOperations = db
        .select({ id: operations.id })
        .from(operations)
        .where(and(eq(operations.orgId, ctx.orgId), eq(operations.operationDate, today)));
      conditions.push(inArray(packages.operationId, todayOperations));
    }
    if (!isStaff && ctx.roles.includes("driver")) {
      const myRoutes = db
        .select({ id: routes.id })
        .from(routes)
        .where(eq(routes.assignedDriverId, ctx.userId));
      conditions.push(inArray(packages.routeId, myRoutes));
    }

    if (query.status) conditions.push(eq(packages.status, query.status));
    if (query.search) {
      const searchCond = or(
        like(packages.internalCode, `%${query.search}%`),
        like(packages.trackingCode, `%${query.search}%`),
      );
      if (searchCond) conditions.push(searchCond);
    }
    if (query.operationId) conditions.push(eq(packages.operationId, query.operationId));

    const where = and(...conditions);

    const [totalRow] = await db.select({ n: count() }).from(packages).where(where);
    const total = totalRow?.n ?? 0;

    const rows = await db
      .select({
        id: packages.id,
        internalCode: packages.internalCode,
        trackingCode: packages.trackingCode,
        status: packages.status,
        recipientName: packages.recipientName,
        rawAddressText: packages.rawAddressText,
        destinationSource: packages.destinationSource,
        destinationConfidence: packages.destinationConfidence,
        priority: packages.priority,
        routeId: packages.routeId,
        bulkNumber: packages.bulkNumber,
        operationId: packages.operationId,
        clientId: packages.clientId,
        createdAt: packages.createdAt,
      })
      .from(packages)
      .where(where)
      .orderBy(desc(packages.createdAt))
      .limit(pageSize)
      .offset(offset);

    return jsonOk({ items: rows }, paginationMeta(page, pageSize, total));
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
