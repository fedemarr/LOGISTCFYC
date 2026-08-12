import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  Errors,
  jsonError,
  jsonOk,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { db } from "@/lib/db";
import { knownAddresses, packages, routes, routeStops, users } from "@/lib/db/schema";

const paramsSchema = z.object({ id: z.string().uuid("id de ruta inválido") });

/** GET /api/routes/:id — detalle de una ruta con sus paradas en orden (§7: `route_stops.sequence`). */
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
    const { id: routeId } = await parseParams(paramsSchema, params);

    const [route] = await db
      .select()
      .from(routes)
      .where(and(eq(routes.id, routeId), eq(routes.orgId, ctx.orgId)));
    if (!route) throw Errors.notFound("ruta no encontrada");

    if (ctx.roles.includes("driver") && !ctx.roles.some((r) => r !== "driver")) {
      if (route.assignedDriverId !== ctx.userId) {
        throw Errors.forbidden("esta ruta no está asignada a tu usuario");
      }
    }

    const driverName = route.assignedDriverId
      ? ((
          await db
            .select({ fullName: users.fullName })
            .from(users)
            .where(eq(users.id, route.assignedDriverId))
        )[0]?.fullName ?? null)
      : null;

    const stops = await db
      .select({
        stopId: routeStops.id,
        sequence: routeStops.sequence,
        status: routeStops.status,
        distanceFromPrevM: routeStops.distanceFromPrevM,
        durationFromPrevS: routeStops.durationFromPrevS,
        packageId: packages.id,
        internalCode: packages.internalCode,
        trackingCode: packages.trackingCode,
        bulkNumber: packages.bulkNumber,
        recipientName: packages.recipientName,
        rawAddressText: packages.rawAddressText,
        lat: knownAddresses.lat,
        lng: knownAddresses.lng,
      })
      .from(routeStops)
      .innerJoin(packages, eq(packages.id, routeStops.packageId))
      .leftJoin(knownAddresses, eq(knownAddresses.id, packages.addressId))
      .where(eq(routeStops.routeId, routeId))
      .orderBy(asc(routeStops.sequence));

    return jsonOk({ ...route, driverName, stops });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
