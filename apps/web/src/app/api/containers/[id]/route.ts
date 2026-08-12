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
import { containers } from "@/lib/db/schema";

/**
 * GET /api/containers/:id — detalle de un contenedor (staff).
 * PATCH /api/containers/:id — edita un contenedor (admin).
 * DELETE /api/containers/:id — soft delete (admin).
 */
const paramsSchema = z.object({
  id: z.string().uuid("id de contenedor inválido"),
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
        id: containers.id,
        code: containers.code,
        qrPayload: containers.qrPayload,
        type: containers.type,
        isActive: containers.isActive,
        createdAt: containers.createdAt,
      })
      .from(containers)
      .where(
        and(
          eq(containers.id, id),
          eq(containers.orgId, ctx.orgId),
          isNull(containers.deletedAt),
        ),
      );
    if (!row) throw Errors.notFound("contenedor no encontrado");

    return jsonOk(row);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

const patchSchema = z.object({
  code: z.string().trim().min(1, "el código es obligatorio").max(50).optional(),
  qrPayload: z.string().trim().max(200).nullable().optional(),
  type: z.enum(["BAG", "CART", "CAGE", "SHELF"]).optional(),
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
      .select({ id: containers.id })
      .from(containers)
      .where(and(eq(containers.id, id), isNull(containers.deletedAt)));
    if (!existing) throw Errors.notFound("contenedor no encontrado");

    const patch: Partial<typeof containers.$inferSelect> = {};
    if (body.code !== undefined) patch.code = body.code.toUpperCase();
    if (body.qrPayload !== undefined) patch.qrPayload = body.qrPayload;
    if (body.type !== undefined) patch.type = body.type;
    if (body.isActive !== undefined) patch.isActive = body.isActive;

    await db.update(containers).set(patch).where(eq(containers.id, id));

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
      .update(containers)
      .set({ deletedAt: new Date(), isActive: false })
      .where(and(eq(containers.id, id), isNull(containers.deletedAt)));

    return jsonOk({ id });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
