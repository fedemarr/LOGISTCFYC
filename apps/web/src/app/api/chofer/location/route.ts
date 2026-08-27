import { z } from "zod";
import { jsonError, jsonOk, parseBody, toAppError } from "@/lib/api";
import { requireDriver } from "@/lib/services/driver-qr";
import { recordLocation } from "@/lib/services/shifts";

/**
 * UBICACIÓN GPS EN VIVO (FYM) — PWA del chofer.
 * POST /api/chofer/location { lat, lng, accuracyM?, speedMps?, ... }
 *
 * Graba el punto, lo relaciona al turno activo del chofer y corre el motor
 * de geocerca (alerta LEFT_ZONE si salió del radio, o la resuelve si volvió).
 * Devuelve el resultado de la geocerca para que la PWA lo muestre al chofer.
 */

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(10_000).optional(),
  speedMps: z.number().min(0).max(200).optional(),
  heading: z.number().min(0).max(360).optional(),
  batteryLevel: z.number().min(0).max(100).optional(),
  isMoving: z.boolean().optional(),
  recordedAt: z.string().datetime().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const driver = await requireDriver(request);
    const body = await parseBody(locationSchema, request);

    const result = await recordLocation(driver, body);

    return jsonOk({
      received: true,
      geofence: result.geofence,
    });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
