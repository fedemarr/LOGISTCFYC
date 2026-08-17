import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { routeQrPayload } from "@fyc/shared";
import {
  Errors,
  jsonError,
  jsonOk,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { db } from "@/lib/db";
import { routes } from "@/lib/db/schema";

const paramsSchema = z.object({ id: z.string().uuid("id de ruta inválido") });

/**
 * GET /api/routes/:id/qr — payload del QR de la ruta (FASE A del flujo de
 * escaneo). El QR codifica solo `FYC-ROUTE-<routeId>`; la app resuelve
 * paquetes/zona/hoja desde el servidor al escanear (ver
 * packages/shared/src/lib/route-id.ts). El QR es útil recién con la ruta
 * aprobada (antes `bulk_number` no está congelado y la custodia no abre),
 * pero se devuelve en cualquier estado para que el panel pueda mostrarlo.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id: routeId } = await parseParams(paramsSchema, params);

    const [route] = await db
      .select({ id: routes.id })
      .from(routes)
      .where(and(eq(routes.id, routeId), eq(routes.orgId, ctx.orgId)));
    if (!route) throw Errors.notFound("ruta no encontrada");

    return jsonOk({ payload: routeQrPayload(route.id) });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
