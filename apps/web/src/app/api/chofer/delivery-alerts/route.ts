import { z } from "zod";
import { jsonError, jsonOk, parseBody, toAppError } from "@/lib/api";
import { requireDriver } from "@/lib/services/driver-qr";
import { createDeliveryAlert } from "@/lib/services/delivery-alerts";

/**
 * ALERTAS DE ENTREGA (FYM) — PWA del chofer.
 * POST /api/chofer/delivery-alerts → reporta un problema de entrega del
 *   turno activo (fire-and-forget): motivo, teléfono de contacto del
 *   destinatario (opcional) y nota. No bloquea ni pide confirmación — el
 *   chofer no tiene que frenar, control llama al teléfono.
 */

const createSchema = z.object({
  reason: z.enum(["NOT_HOME", "REFUSED", "OTHER"]),
  // Ambos opcionales de verdad: el cliente los omite del body (no manda
  // "" ni null) cuando el chofer los deja en blanco — `JSON.stringify`
  // descarta las claves en `undefined` — así que sin `.optional()` acá
  // Zod los rechazaba como "Required" y el reporte fallaba siempre que
  // faltara el teléfono o la nota (el caso común: "fire-and-forget").
  contactPhone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9+\s()-]*$/, "teléfono inválido")
    .optional(),
  note: z.string().trim().max(500).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const driver = await requireDriver(request);
    const body = await parseBody(createSchema, request);
    const alert = await createDeliveryAlert(driver, {
      reason: body.reason,
      contactPhone: body.contactPhone || undefined,
      note: body.note || undefined,
    });
    return jsonOk({ alert }, undefined, { status: 201 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
