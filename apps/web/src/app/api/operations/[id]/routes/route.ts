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
import {
  containers,
  operations,
  packages,
  routeStops,
  routes,
  users,
  vehicles,
} from "@/lib/db/schema";
import {
  generateRouteProposal,
  resolveDepotLocation,
} from "@/lib/services/route-planning";

const paramsSchema = z.object({ id: z.string().uuid("id de operación inválido") });

/**
 * GET /api/operations/:id/routes — rutas de la operación con conteo de
 * paradas y capacidad del vehículo (para la barra de ocupación del
 * planificador, PROMPT-FRONTEND-V2 §6.1: verde <85%, ámbar 85-100%, rojo
 * >100%).
 */
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

        const [driver] = route.assignedDriverId
          ? await db
              .select({ fullName: users.fullName })
              .from(users)
              .where(eq(users.id, route.assignedDriverId))
          : [];
        const [vehicle] = route.vehicleId
          ? await db
              .select({
                capacityPackages: vehicles.capacityPackages,
                plate: vehicles.plate,
              })
              .from(vehicles)
              .where(eq(vehicles.id, route.vehicleId))
          : [];
        const [container] = route.containerId
          ? await db
              .select({ code: containers.code })
              .from(containers)
              .where(eq(containers.id, route.containerId))
          : [];

        return {
          ...route,
          stopCount: stopCount?.n ?? 0,
          driverName: driver?.fullName ?? null,
          vehiclePlate: vehicle?.plate ?? null,
          capacityPackages: vehicle?.capacityPackages ?? null,
          containerCode: container?.code ?? null,
        };
      }),
    );

    // El depósito puede no estar configurado todavía (ADR-033) — no
    // rompe el listado, el mapa simplemente no dibuja el marcador.
    const depot = await resolveDepotLocation(ctx.orgId).catch(() => null);

    // Paquetes GEOCODIFICADO sin ruta todavía — mismo filtro que usa
    // `generateRouteProposal` para decidir qué entra en la próxima corrida
    // ("agregar ruta", §8). Se muestra en el panel para que el dispatcher
    // sepa si vale la pena tocar el botón antes de tocarlo.
    const [freeCount] = await db
      .select({ n: count() })
      .from(packages)
      .where(
        and(
          eq(packages.orgId, ctx.orgId),
          eq(packages.operationId, operationId),
          eq(packages.status, "GEOCODIFICADO"),
          isNull(packages.routeId),
          isNull(packages.deletedAt),
        ),
      );

    return jsonOk({ items, depot, freePackageCount: freeCount?.n ?? 0 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

/**
 * POST /api/operations/:id/routes — genera la propuesta de ruteo (§8,
 * etapas 1 y 2) sobre los paquetes GEOCODIFICADO **sin ruta todavía** de
 * la operación. Se puede llamar más de una vez por operación a propósito
 * (§8: "agregar ruta") — cada corrida solo toma los paquetes libres
 * (`routeId IS NULL`) y los vehículos AVAILABLE sin ruta activa en esta
 * operación (`generateRouteProposal`/`fetchAvailableVehicles` filtran
 * eso), así que nunca duplica ni re-rutea lo que ya está armado. Si no
 * queda nada libre para rutear, tira `VALIDATION_ERROR` explícito.
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

    const result = await generateRouteProposal(ctx.orgId, operationId);
    return jsonOk(result, undefined, { status: 201 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
