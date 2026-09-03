import { z } from "zod";
import {
  actorFrom,
  jsonError,
  jsonOk,
  parseBody,
  requireRole,
  toAppError,
} from "@/lib/api";
import { connectStore, disconnectStore, getConnection } from "@/lib/services/tiendanube";

/**
 * CONEXIÓN CON TIENDA NUBE (FYM) — admin (credenciales sensibles, mismo
 * criterio que cualquier otra clave de API del sistema).
 * GET    /api/tiendanube/connection → estado de la conexión (sin el token).
 * POST   /api/tiendanube/connection → conectar/reemplazar { storeId, accessToken }.
 * DELETE /api/tiendanube/connection → desconectar.
 */

const connectSchema = z.object({
  storeId: z.string().trim().min(1, "falta el store_id"),
  accessToken: z.string().trim().min(10, "token inválido"),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin"]);
    const connection = await getConnection(ctx.orgId);
    return jsonOk({ connection });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin"]);
    const body = await parseBody(connectSchema, request);
    const connection = await connectStore(ctx.orgId, actorFrom(ctx), body);
    return jsonOk({ connection });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const ctx = await requireRole(request, ["admin"]);
    await disconnectStore(ctx.orgId, actorFrom(ctx));
    return jsonOk({ disconnected: true });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
