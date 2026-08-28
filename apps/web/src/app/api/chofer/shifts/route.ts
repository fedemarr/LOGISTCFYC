import { z } from "zod";
import { jsonError, jsonOk, parseBody, toAppError } from "@/lib/api";
import { requireDriver } from "@/lib/services/driver-qr";
import { getCurrentShiftForDriver, startShift } from "@/lib/services/shifts";

/**
 * TURNOS (FYM) — PWA del chofer.
 * GET  /api/chofer/shifts      → turno actual del chofer (PENDING o ACTIVE), si hay.
 * POST /api/chofer/shifts      → arrancar turno
 *   { zoneId | zoneName, packageCount, flexScreenshotBase64, flexScreenshotMimeType }.
 */

const startSchema = z
  .object({
    zoneId: z.string().uuid().optional(),
    // El chofer escribe la zona en vez de elegir de una lista (pedido de
    // Fede) — se geocodifica y se crea/reusa en `startShift`.
    zoneName: z.string().min(2).max(150).optional(),
    packageCount: z.number().int().min(1).max(1_000_000),
    // Captura de Flex (pedido de Fede: "pago x paquete") — la IA la lee y
    // confirma sola si coincide con `packageCount`, si no queda PENDING
    // para que alguien del depósito la revise. Base64 SIN el prefijo
    // `data:...;base64,` — el cliente ya lo comprime antes de mandarlo.
    flexScreenshotBase64: z.string().min(100),
    flexScreenshotMimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  })
  .refine((v) => v.zoneId ?? v.zoneName, {
    message: "hace falta zoneId o zoneName",
    path: ["zoneName"],
  });

export async function POST(request: Request): Promise<Response> {
  try {
    const driver = await requireDriver(request);
    // Default de parseBody es 1MB — la captura de Flex comprimida en
    // base64 puede pasarse de eso, así que se sube el límite acá.
    const body = await parseBody(startSchema, request, { maxBytes: 4_000_000 });

    const shift = await startShift(driver, {
      ...(body.zoneName ? { zoneName: body.zoneName } : { zoneId: body.zoneId! }),
      packageCount: body.packageCount,
      flexScreenshotBase64: body.flexScreenshotBase64,
      flexScreenshotMimeType: body.flexScreenshotMimeType,
    });
    return jsonOk({ shift }, undefined, { status: 201 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const driver = await requireDriver(request);
    const current = await getCurrentShiftForDriver(driver.userId, driver.orgId);
    if (!current) return jsonOk({ shift: null });

    return jsonOk({
      shift: {
        id: current.shift.id,
        zoneId: current.shift.zoneId,
        packageCount: current.shift.packageCount,
        startedAt: current.shift.startedAt,
        status: current.shift.status,
      },
    });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
