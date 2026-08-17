import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseBody,
  parseQuery,
  requireRole,
  toAppError,
} from "@/lib/api";
import { paginationFrom } from "@/lib/api/http";
import {
  listTickets,
  createTicket,
  type TicketCategory,
  type TicketPriority,
} from "@/lib/services/support";

const createSchema = z.object({
  category: z.enum(["GENERAL", "TECHNICAL", "PAYMENT", "ROUTE", "VEHICLE", "OTHER"]),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(4000),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  packageId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
});

/**
 * GET/POST /api/tickets — listado (staff: todos de la org; driver: los
 * suyos) y creación de tickets con el primer mensaje del hilo (FASE 12).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "driver"]);
    const url = new URL(request.url);
    const query = parseQuery(querySchema, url);
    const { page, pageSize } = paginationFrom(query);

    await consumeRateLimit(`tickets:list:${ctx.userId}`, {
      limit: 120,
      windowSeconds: 60,
    });

    const result = await listTickets({
      orgId: ctx.orgId,
      actor: { userId: ctx.userId, roles: ctx.roles },
      page,
      pageSize,
      search: query.search,
      status: query.status as never,
    });
    return jsonOk(
      { items: result.items },
      {
        page,
        pageSize,
        total: result.total,
        pages: Math.max(1, Math.ceil(result.total / pageSize)),
      },
    );
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "driver"]);
    const body = await parseBody(createSchema, request);

    await consumeRateLimit(`tickets:create:${ctx.userId}`, {
      limit: 20,
      windowSeconds: 60,
    });

    const result = await createTicket(ctx.orgId, body, {
      userId: ctx.userId,
      roles: ctx.roles,
    });
    return jsonOk(result, undefined, { status: 201 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

// Exportado solo para que el barrel de tipos no rompa si se referencia.
export type { TicketCategory, TicketPriority };
