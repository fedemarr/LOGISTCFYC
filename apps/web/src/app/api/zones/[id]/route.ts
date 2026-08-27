import { z } from "zod";
import {
  actorFrom,
  jsonError,
  jsonOk,
  parseBody,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { softDeleteZone, updateZone } from "@/lib/services/zones";

/**
 * ZONAS (FYM) — admin/dispatcher.
 * PATCH  /api/zones/:id → actualiza la zona
 * DELETE /api/zones/:id → soft delete de la zona
 */

const paramsSchema = z.object({ id: z.string().uuid("id inválido") });

const patchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  colorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "color hex inválido")
    .optional(),
  centerLat: z.number().min(-90).max(90).optional(),
  centerLng: z.number().min(-180).max(180).optional(),
  radiusM: z.number().int().min(100).max(50_000).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const { id } = await parseParams(paramsSchema, context.params);
    const body = await parseBody(patchSchema, request);
    const zone = await updateZone(ctx.orgId, id, actorFrom(ctx), body);
    return jsonOk(zone);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin"]);
    const { id } = await parseParams(paramsSchema, context.params);
    await softDeleteZone(ctx.orgId, id, actorFrom(ctx));
    return jsonOk({ ok: true });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
