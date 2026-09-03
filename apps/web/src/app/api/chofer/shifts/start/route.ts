import { jsonError, jsonOk, toAppError } from "@/lib/api";
import { requireDriver } from "@/lib/services/driver-qr";
import { startAssignedShift } from "@/lib/services/shifts";

/**
 * INICIAR TURNO ASIGNADO (FYM) — PWA del chofer. Pedido de Fede: "que el
 * admin pueda pre-armar el turno" — el chofer ve "Turno asignado" y solo
 * tiene que tocar "Iniciar" (sin tipear zona/paquetes ni subir captura).
 * POST /api/chofer/shifts/start
 */

export async function POST(request: Request): Promise<Response> {
  try {
    const driver = await requireDriver(request);
    const shift = await startAssignedShift(driver);
    return jsonOk({ shift });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
