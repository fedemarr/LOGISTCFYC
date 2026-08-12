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
import { users, vehicles } from "@/lib/db/schema";

/**
 * GET /api/vehicles/:id — detalle de un vehículo (staff).
 * PATCH /api/vehicles/:id — edita un vehículo (admin).
 * DELETE /api/vehicles/:id — soft delete (admin).
 */
const paramsSchema = z.object({
  id: z.string().uuid("id de vehículo inválido"),
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
        id: vehicles.id,
        plate: vehicles.plate,
        brand: vehicles.brand,
        model: vehicles.model,
        year: vehicles.year,
        capacityPackages: vehicles.capacityPackages,
        capacityM3: vehicles.capacityM3,
        capacityKg: vehicles.capacityKg,
        status: vehicles.status,
        currentOdometer: vehicles.currentOdometer,
        insuranceExpiry: vehicles.insuranceExpiry,
        vtvExpiry: vehicles.vtvExpiry,
        assignedDriverId: vehicles.assignedDriverId,
        assignedDriverName: users.fullName,
        createdAt: vehicles.createdAt,
      })
      .from(vehicles)
      .leftJoin(users, eq(users.id, vehicles.assignedDriverId))
      .where(
        and(
          eq(vehicles.id, id),
          eq(vehicles.orgId, ctx.orgId),
          isNull(vehicles.deletedAt),
        ),
      );
    if (!row) throw Errors.notFound("vehículo no encontrado");

    return jsonOk(row);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

const patchSchema = z.object({
  plate: z.string().trim().min(1, "la patente es obligatoria").max(20).optional(),
  brand: z.string().trim().max(50).nullable().optional(),
  model: z.string().trim().max(50).nullable().optional(),
  year: z.coerce.number().int().min(1950).max(2100).nullable().optional(),
  capacityPackages: z.coerce.number().int().min(1).max(10000).nullable().optional(),
  capacityM3: z.coerce.number().positive().nullable().optional(),
  capacityKg: z.coerce.number().positive().nullable().optional(),
  status: z.enum(["AVAILABLE", "IN_ROUTE", "MAINTENANCE", "OUT_OF_SERVICE"]).optional(),
  currentOdometer: z.coerce.number().int().min(0).nullable().optional(),
  insuranceExpiry: z.string().date("fecha inválida").nullable().optional(),
  vtvExpiry: z.string().date("fecha inválida").nullable().optional(),
  assignedDriverId: z.string().uuid("chofer inválido").nullable().optional(),
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
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.id, id), isNull(vehicles.deletedAt)));
    if (!existing) throw Errors.notFound("vehículo no encontrado");

    const patch: Partial<typeof vehicles.$inferSelect> = {};
    if (body.plate !== undefined) patch.plate = body.plate.toUpperCase();
    if (body.brand !== undefined) patch.brand = body.brand;
    if (body.model !== undefined) patch.model = body.model;
    if (body.year !== undefined) patch.year = body.year;
    if (body.capacityPackages !== undefined)
      patch.capacityPackages = body.capacityPackages;
    if (body.capacityM3 !== undefined) patch.capacityM3 = body.capacityM3;
    if (body.capacityKg !== undefined) patch.capacityKg = body.capacityKg;
    if (body.status !== undefined) patch.status = body.status;
    if (body.currentOdometer !== undefined) patch.currentOdometer = body.currentOdometer;
    if (body.insuranceExpiry !== undefined) patch.insuranceExpiry = body.insuranceExpiry;
    if (body.vtvExpiry !== undefined) patch.vtvExpiry = body.vtvExpiry;
    if (body.assignedDriverId !== undefined)
      patch.assignedDriverId = body.assignedDriverId;

    await db.update(vehicles).set(patch).where(eq(vehicles.id, id));

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
      .update(vehicles)
      .set({ deletedAt: new Date() })
      .where(and(eq(vehicles.id, id), isNull(vehicles.deletedAt)));

    return jsonOk({ id });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
