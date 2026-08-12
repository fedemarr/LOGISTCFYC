import { z } from "zod";
import { jsonError, parseParams, parseQuery, requireRole, toAppError } from "@/lib/api";
import { generateRouteLabelsPdf } from "@/lib/services/labels";

const paramsSchema = z.object({ id: z.string().uuid("id de ruta inválido") });
const querySchema = z.object({ format: z.enum(["thermal", "a4"]).optional() });

/**
 * GET /api/routes/:id/labels?format=thermal|a4 — PDF listo para imprimir
 * (§9.2). Devuelve el binario directo (no el envelope JSON estándar — no
 * hay `data` que envolver, es un archivo).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin", "dispatcher", "warehouse"]);
    const { id: routeId } = await parseParams(paramsSchema, params);
    const url = new URL(request.url);
    const { format } = parseQuery(querySchema, url);

    const pdfBytes = await generateRouteLabelsPdf(
      ctx.orgId,
      routeId,
      format ?? "thermal",
    );

    return new Response(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="etiquetas-ruta-${routeId}.pdf"`,
      },
    });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
