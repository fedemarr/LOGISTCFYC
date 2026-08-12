import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  Errors,
  jsonError,
  jsonOk,
  parseBody,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";

/**
 * GET /api/clients/:id — detalle de un cliente (staff).
 * PATCH /api/clients/:id — edita un cliente (admin).
 * DELETE /api/clients/:id — soft delete (admin).
 */
const paramsSchema = z.object({
  id: z.string().uuid("id de cliente inválido"),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id } = await parseParams(paramsSchema, params);

    const [row] = await db
      .select({
        id: clients.id,
        name: clients.name,
        contact: clients.contact,
        isActive: clients.isActive,
        createdAt: clients.createdAt,
      })
      .from(clients)
      .where(
        and(eq(clients.id, id), eq(clients.orgId, ctx.orgId), isNull(clients.deletedAt)),
      );
    if (!row) throw Errors.notFound("cliente no encontrado");

    return jsonOk(row);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

const patchSchema = z.object({
  name: z.string().trim().min(1, "el nombre es obligatorio").max(200).optional(),
  contact: z.string().trim().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireRole(request, ["admin"]);
    const { id } = await parseParams(paramsSchema, params);
    const body = await parseBody(patchSchema, request);

    const [existing] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)));
    if (!existing) throw Errors.notFound("cliente no encontrado");

    const patch: Partial<typeof clients.$inferSelect> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.contact !== undefined) patch.contact = body.contact;
    if (body.isActive !== undefined) patch.isActive = body.isActive;

    await db.update(clients).set(patch).where(eq(clients.id, id));

    return jsonOk({ id });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireRole(request, ["admin"]);
    const { id } = await parseParams(paramsSchema, params);

    await db
      .update(clients)
      .set({ deletedAt: new Date(), isActive: false })
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)));

    return jsonOk({ id });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
