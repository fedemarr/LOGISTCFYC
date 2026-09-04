import { z } from "zod";
import { jsonError, jsonOk, parseBody, parseParams, toAppError } from "@/lib/api";
import { requireDriver } from "@/lib/services/driver-qr";
import { markOrderDeliveredByDriver } from "@/lib/services/orders";

/**
 * MARCAR ENTREGADO DESDE LA PWA (FYM) — pedido de Fede: foto de
 * confirmación + a quién se le entregó (nombre y DNI), los tres
 * obligatorios. Empuja el estado a Tienda Nube igual que la versión del
 * panel (`/api/orders/:id/deliver`) — ver `markOrderDeliveredByDriver`.
 * POST /api/chofer/orders/:id/deliver
 *   { evidenceBase64, evidenceMimeType, recipientName, recipientDni }
 */

const paramsSchema = z.object({ id: z.string().uuid("id inválido") });
const bodySchema = z.object({
  evidenceBase64: z.string().min(100),
  evidenceMimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  recipientName: z.string().trim().min(2, "falta el nombre de quien recibe").max(200),
  recipientDni: z.string().trim().min(4, "falta el DNI de quien recibe").max(30),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const driver = await requireDriver(request);
    const { id } = await parseParams(paramsSchema, context.params);
    // La foto comprimida en base64 puede superar el límite default de
    // parseBody (1MB) — mismo criterio que /api/chofer/shifts.
    const body = await parseBody(bodySchema, request, { maxBytes: 4_000_000 });

    const result = await markOrderDeliveredByDriver(
      driver.orgId,
      id,
      driver,
      body.evidenceBase64,
      body.evidenceMimeType,
      body.recipientName,
      body.recipientDni,
    );
    return jsonOk(result);
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
