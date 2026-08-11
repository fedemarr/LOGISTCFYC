import { PACKAGE_STATUSES } from "@fyc/state-machine";
import { z } from "zod";
import {
  consumeRateLimit,
  jsonError,
  jsonOk,
  parseBody,
  parseParams,
  requireUser,
  toAppError,
} from "@/lib/api";
import { runPackageTransition } from "@/lib/services/state-machine";

/**
 * POST /api/packages/:id/transition — PATRÓN DE REFERENCIA de un endpoint
 * de mutación (FASE 3). La autorización por rol y las precondiciones las
 * valida la máquina de estados adentro de `runPackageTransition` (que las
 * excepciones del dominio se mapean a `AppError` vía `toAppError` acá);
 * este handler solo autentica, valida el body con Zod y aplica rate
 * limiting. Ver docs/API.md.
 */
const bodySchema = z.object({
  toStatus: z.enum([...PACKAGE_STATUSES]),
  metadata: z.record(z.unknown()).optional(),
});

const paramsSchema = z.object({
  id: z.string().uuid("id de paquete inválido"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireUser(request);
    const { id } = await parseParams(paramsSchema, params);
    const body = await parseBody(bodySchema, request);

    await consumeRateLimit(`transition:${ctx.userId}`, { limit: 120, windowSeconds: 60 });

    const result = await runPackageTransition({
      packageId: id,
      toStatus: body.toStatus,
      actorId: ctx.userId,
      actorRoles: ctx.roles,
      metadata: body.metadata,
    });

    return jsonOk(result, undefined, { status: 201 });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
