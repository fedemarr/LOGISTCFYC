import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { jsonError, jsonOk, parseParams, requireRole, toAppError } from "@/lib/api";
import { db } from "@/lib/db";
import { packages } from "@/lib/db/schema";

const paramsSchema = z.object({ id: z.string().uuid("id de operación inválido") });

/**
 * GET /api/operations/:id/pending — bandeja de resolución (§2, §9.1 paso
 * 4): paquetes que ninguna etapa de la cascada pudo resolver. "Ningún
 * paquete queda fuera del sistema" — están acá, esperando a un humano.
 *
 * Incluye `rawAddressText` porque un paquete puede llegar acá con la
 * dirección YA cargada desde el manifiesto (import con columna de
 * dirección) — sigue necesitando confirmación humana de recepción
 * física, pero el panel no debe pedirle a nadie que la retipee.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id: operationId } = await parseParams(paramsSchema, params);

    const rows = await db
      .select({
        id: packages.id,
        internalCode: packages.internalCode,
        trackingCode: packages.trackingCode,
        recipientName: packages.recipientName,
        recipientPhone: packages.recipientPhone,
        rawAddressText: packages.rawAddressText,
        labelPhotoUrl: packages.labelPhotoUrl,
        createdAt: packages.createdAt,
      })
      .from(packages)
      .where(
        and(
          eq(packages.orgId, ctx.orgId),
          eq(packages.operationId, operationId),
          eq(packages.status, "PENDIENTE_RESOLUCION"),
          isNull(packages.deletedAt),
        ),
      )
      .orderBy(packages.createdAt);

    return jsonOk({ items: rows });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
