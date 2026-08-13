/**
 * QR de identificación del chofer — control de salida del depósito (pedido
 * explícito de Fede: además del login, depósito escanea al chofer antes de
 * que salga con la ruta cargada). Prefijo propio (`FYC-DRIVER-`) para que
 * nunca se confunda con un código de contenedor (`FYC-CONT-`) o de paquete
 * si alguien lo escanea en el lugar equivocado — mismo criterio que separa
 * esos dos hoy.
 *
 * Vive en `@fyc/shared` porque tanto la app (genera el QR, 100% local, sin
 * pedirle nada al servidor — funciona offline) como el backend (lo
 * interpreta cuando depósito lo escanea) necesitan acordar el mismo
 * formato exacto.
 */
const DRIVER_QR_PREFIX = "FYC-DRIVER-";

export function driverQrPayload(userId: string): string {
  return `${DRIVER_QR_PREFIX}${userId}`;
}

/** Devuelve el userId si `code` tiene forma de QR de chofer, `null` si no. */
export function parseDriverQrPayload(code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith(DRIVER_QR_PREFIX)) return null;
  const userId = trimmed.slice(DRIVER_QR_PREFIX.length).trim();
  return userId.length > 0 ? userId : null;
}
