import { z } from "zod";
import { jsonError, jsonOk, parseBody, toAppError } from "@/lib/api";
import { requireDriver } from "@/lib/services/driver-qr";
import { getActiveShiftForDriver, startShift } from "@/lib/services/shifts";

/**
 * TURNOS (FYM) — PWA del chofer.
 * GET  /api/chofer/shifts      → turno activo del chofer (si hay).
 * POST /api/chofer/shifts      → arrancar turno { zoneId | zoneName, packageCount }.
 */

const startSchema = z
  .object({
    zoneId: z.string().uuid().optional(),
    // El chofer escribe la zona en vez de elegir de una lista (pedido de
    // Fede) — se geocodifica y se crea/reusa en `startShift`.
    zoneName: z.string().min(2).max(150).optional(),
    packageCount: z.number().int().min(1).max(1_000_000),
  })
  .refine((v) => v.zoneId ?? v.zoneName, {
    message: "hace falta zoneId o zoneName",
    path: ["zoneName"],
  });

export async function POST(request: Request): Promise<Response> {
  try {
    const driver = await requireDriver(request);
    const body = await parseBody(startSchema, request);

    const shift = await startShift(
      driver,
      body.zoneName
        ? { zoneName: body.zoneName, packageCount: body.packageCount }
        : { zoneId: body.zoneId!, packageCount: body.packageCount },
    );
    return jsonOk({ shift }, undefined, { status: 201 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const driver = await requireDriver(request);
    const active = await getActiveShiftForDriver(driver.userId, driver.orgId);
    if (!active) return jsonOk({ shift: null });

    return jsonOk({
      shift: {
        id: active.shift.id,
        zoneId: active.shift.zoneId,
        packageCount: active.shift.packageCount,
        startedAt: active.shift.startedAt,
        status: active.shift.status,
      },
    });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
