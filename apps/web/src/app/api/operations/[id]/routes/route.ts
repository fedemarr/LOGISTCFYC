import { and, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  consumeRateLimit,
  Errors,
  jsonError,
  jsonOk,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { db } from "@/lib/db";
import { operations, routeStops, routes } from "@/lib/db/schema";
import { generateRouteProposal } from "@/lib/services/route-planning";

const paramsSchema = z.object({ id: z.string().uuid("id de operación inválido") });

/** GET /api/operations/:id/routes — rutas de la operación con conteo de paradas. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, [
      "admin",
      "dispatcher",
      "warehouse",
      "driver",
    ]);
    const { id: operationId } = await parseParams(paramsSchema, params);

    const rows = await db
      .select()
      .from(routes)
      .where(
        and(
          eq(routes.orgId, ctx.orgId),
          eq(routes.operationId, operationId),
          isNull(routes.deletedAt),
        ),
      )
      .orderBy(routes.routeNumber);

    const items = await Promise.all(
      rows.map(async (route) => {
        const [stopCount] = await db
          .select({ n: count() })
          .from(routeStops)
          .where(eq(routeStops.routeId, route.id));
        return { ...route, stopCount: stopCount?.n ?? 0 };
      }),
    );

    return jsonOk({ items });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

/**
 * POST /api/operations/:id/routes — genera la propuesta de ruteo (§8,
 * etapas 1 y 2) sobre los paquetes GEOCODIFICADO de la operación. Idempotente
 * en el sentido de "no se puede correr dos veces": si ya hay rutas para
 * esta operación, hay que revisar/aprobar/borrar las existentes primero —
 * evita duplicar paquetes en dos propuestas a la vez.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id: operationId } = await parseParams(paramsSchema, params);

    await consumeRateLimit(`routes:generate:${ctx.userId}`, {
      limit: 5,
      windowSeconds: 60,
    });

    const [operation] = await db
      .select({ id: operations.id })
      .from(operations)
      .where(and(eq(operations.id, operationId), eq(operations.orgId, ctx.orgId)));
    if (!operation) throw Errors.notFound("operación no encontrada");

    const [existing] = await db
      .select({ id: routes.id })
      .from(routes)
      .where(
        and(
          eq(routes.orgId, ctx.orgId),
          eq(routes.operationId, operationId),
          isNull(routes.deletedAt),
        ),
      );
    if (existing) {
      throw Errors.conflict(
        "esta operación ya tiene una propuesta de ruteo — ajustala o eliminá las rutas DRAFT antes de generar otra",
      );
    }

    const result = await generateRouteProposal(ctx.orgId, operationId);
    return jsonOk(result, undefined, { status: 201 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
