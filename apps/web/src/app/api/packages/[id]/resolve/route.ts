import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  consumeRateLimit,
  Errors,
  jsonError,
  jsonOk,
  parseBody,
  parseParams,
  requireRole,
  toAppError,
} from "@/lib/api";
import { db } from "@/lib/db";
import { packages } from "@/lib/db/schema";
import { runPackageTransition } from "@/lib/services/state-machine";

/**
 * POST /api/packages/:id/resolve — bandeja de resolución, último escalón
 * de la cascada (§2, MANUAL): un humano completa la dirección con la foto
 * de la etiqueta al lado. Transiciona PENDIENTE_RESOLUCION → RECIBIDO con
 * `destinationSource: MANUAL, destinationConfidence: HIGH` (lo confirmó
 * una persona mirando la foto).
 */
const bodySchema = z.object({
  rawAddressText: z.string().trim().min(3).max(500),
  recipientName: z.string().trim().max(200).optional(),
  recipientPhone: z.string().trim().max(50).optional(),
});

const paramsSchema = z.object({ id: z.string().uuid("id de paquete inválido") });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id } = await parseParams(paramsSchema, params);
    const body = await parseBody(bodySchema, request);

    await consumeRateLimit(`packages:resolve:${ctx.userId}`, {
      limit: 200,
      windowSeconds: 60,
    });

    const [pkg] = await db
      .select({ id: packages.id, status: packages.status })
      .from(packages)
      .where(and(eq(packages.id, id), eq(packages.orgId, ctx.orgId)));
    if (!pkg) throw Errors.notFound("paquete no encontrado");

    await db
      .update(packages)
      .set({
        rawAddressText: body.rawAddressText,
        recipientName: body.recipientName,
        recipientPhone: body.recipientPhone,
        destinationSource: "MANUAL",
        destinationConfidence: "HIGH",
        updatedAt: new Date(),
      })
      .where(eq(packages.id, id));

    let status = pkg.status;
    if (pkg.status === "PENDIENTE_RESOLUCION") {
      const result = await runPackageTransition({
        packageId: id,
        toStatus: "RECIBIDO",
        actorId: ctx.userId,
        actorRoles: ctx.roles,
        metadata: { source: "MANUAL" },
      });
      status = result.toStatus;
    }

    return jsonOk({ id, status });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
