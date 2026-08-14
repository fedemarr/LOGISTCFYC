import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseBody,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { getTicket, postTicketMessage, updateTicket } from "@/lib/services/support";

const paramsSchema = z.object({ id: z.string().uuid("id de ticket inválido") });

const messageSchema = z.object({
  message: z.string().trim().min(1).max(4000),
});

const updateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});

/**
 * GET/PATCH/POST /api/tickets/:id — detalle del ticket con el hilo
 * completo de mensajes, actualización de estado/prioridad/asignación
 * (solo staff) y respuesta en el hilo (FASE 12).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "driver"]);
    const { id } = await parseParams(paramsSchema, params);
    await consumeRateLimit(`tickets:get:${ctx.userId}`, {
      limit: 120,
      windowSeconds: 60,
    });

    const detail = await getTicket(ctx.orgId, id, {
      userId: ctx.userId,
      roles: ctx.roles,
    });
    return jsonOk(detail);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const { id } = await parseParams(paramsSchema, params);
    const body = await parseBody(updateSchema, request);

    await consumeRateLimit(`tickets:update:${ctx.userId}`, {
      limit: 60,
      windowSeconds: 60,
    });

    const result = await updateTicket(ctx.orgId, id, body, {
      userId: ctx.userId,
      roles: ctx.roles,
    });
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "driver"]);
    const { id } = await parseParams(paramsSchema, params);
    const body = await parseBody(messageSchema, request);

    await consumeRateLimit(`tickets:message:${ctx.userId}`, {
      limit: 60,
      windowSeconds: 60,
    });

    const result = await postTicketMessage(ctx.orgId, id, body.message, {
      userId: ctx.userId,
      roles: ctx.roles,
    });
    return jsonOk(result, undefined, { status: 201 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
