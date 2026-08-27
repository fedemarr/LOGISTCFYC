import { z } from "zod";
import {
  actorFrom,
  jsonError,
  jsonOk,
  parseBody,
  requireRole,
  toAppError,
} from "@/lib/api";
import { createZone, listZones } from "@/lib/services/zones";

/**
 * ZONAS (FYM) — admin/dispatcher.
 * GET  /api/zones   → lista zonas activas de la org
 * POST /api/zones   → crea una zona (círculo: centro + radio)
 */

const createSchema = z.object({
  name: z.string().min(2).max(100),
  colorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "color hex inválido")
    .optional(),
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(100).max(50_000),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const zones = await listZones(ctx.orgId);
    return jsonOk({ zones });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher"]);
    const body = await parseBody(createSchema, request);
    const zone = await createZone(ctx.orgId, actorFrom(ctx), body);
    return jsonOk(zone, undefined, { status: 201 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
