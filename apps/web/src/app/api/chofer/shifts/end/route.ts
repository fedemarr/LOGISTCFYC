import { z } from "zod";
import { jsonError, jsonOk, parseBody, toAppError } from "@/lib/api";
import { requireDriver } from "@/lib/services/driver-qr";
import { endShift } from "@/lib/services/shifts";

/**
 * CIERRE DE TURNO (FYM) — PWA del chofer.
 * POST /api/chofer/shifts/end { undeliveredCount, notes? }
 * Cierra el turno activo y resuelve alertas de geocerca pendientes.
 */

const endSchema = z.object({
  undeliveredCount: z.number().int().min(0).max(1_000_000),
  notes: z.string().trim().max(500).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const driver = await requireDriver(request);
    const body = await parseBody(endSchema, request);

    const shift = await endShift(driver, body);
    return jsonOk({ shift });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
