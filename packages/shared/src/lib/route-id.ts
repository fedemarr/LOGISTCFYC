/**
 * QR de RUTA — cada ruta aprobada en el panel genera uno (FASE A del flujo
 * de escaneo: el chofer lo escanea, se abre la custodia por conteo y la
 * ruta se habilita). El QR codifica solo `FYC-ROUTE-<routeId>`: los
 * paquetes, la zona y la hoja de ruta NO viajan en el QR — la app resuelve
 * la ruta completa contra el servidor al escanear (los QR son chicos y el
 * payload no debería crecer con los bultos).
 *
 * Prefijo propio para no confundirse con `FYC-DRIVER-` (chofer) ni con el
 * `qr_payload` de los contenedores (`FYC-CONT-...`) si alguien lo escanea
 * en el lugar equivocado — mismo criterio que `driver-id.ts`.
 */
const ROUTE_QR_PREFIX = "FYC-ROUTE-";

export function routeQrPayload(routeId: string): string {
  return `${ROUTE_QR_PREFIX}${routeId}`;
}

/** Devuelve el routeId si `code` tiene forma de QR de ruta, `null` si no. */
export function parseRouteQrPayload(code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith(ROUTE_QR_PREFIX)) return null;
  const routeId = trimmed.slice(ROUTE_QR_PREFIX.length).trim();
  return routeId.length > 0 ? routeId : null;
}
