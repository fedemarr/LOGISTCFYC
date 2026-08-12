/**
 * Contrato del motor de sincronización offline-first (PROMPT-MAESTRO §12).
 * Compartido entre `apps/mobile` (quien arma las acciones en el outbox
 * local) y `apps/web` (quien las valida y procesa) — evita que el shape
 * del payload se desincronice entre los dos runtimes.
 *
 * `SYNC_OPERATION_TYPES` empieza con un solo tipo en FASE 7 (base del
 * motor de sync). Cada fase que agrega una acción offline nueva (entrega,
 * incidencia, llegada a parada) suma su tipo acá — nunca inventar un
 * `operationType` en un solo lado.
 */
export const SYNC_OPERATION_TYPES = ["GPS_PING"] as const;
export type SyncOperationType = (typeof SYNC_OPERATION_TYPES)[number];

/** Un punto de ubicación del chofer (§10) — FASE 7 solo prueba el motor; la config real de frecuencia/precisión es FASE 11. */
export interface GpsPingPayload {
  lat: number;
  lng: number;
  accuracyM?: number;
  speedMps?: number;
  heading?: number;
  batteryLevel?: number;
  isMoving?: boolean;
  routeId?: string;
}

/**
 * Una acción del outbox local, tal como se manda al servidor. `idempotencyKey`
 * se genera en el dispositivo (UUID v4) en el momento de encolar, NO al
 * sincronizar — reenviar la misma acción (reintento, doble tap, app
 * matada a mitad de sync) es siempre seguro porque el servidor dedupe por
 * esta clave (§12: "reenviar es SIEMPRE seguro").
 *
 * `payload` viaja como JSON genérico a nivel transporte — la forma exacta
 * por `operationType` (`GpsPingPayload`, etc.) se valida recién del lado
 * del servidor con Zod al procesar cada acción, no acá. Mandar algo mal
 * formado no rompe el lote entero: esa acción puntual vuelve `FAILED` y
 * el resto se procesa igual.
 */
export interface SyncAction {
  idempotencyKey: string;
  operationType: SyncOperationType;
  payload: Record<string, unknown>;
  /** Hora del DISPOSITIVO al momento de la acción — nunca confundir con la hora del servidor (§10). */
  clientTimestamp: string;
}

export type SyncActionStatus = "COMPLETED" | "DUPLICATE" | "FAILED";

export interface SyncActionResult {
  idempotencyKey: string;
  status: SyncActionStatus;
  error?: string;
}
