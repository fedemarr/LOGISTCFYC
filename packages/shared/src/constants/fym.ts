/**
 * Constantes y tipos de dominio del sistema FYM (control de choferes).
 *
 * El sistema no rastrea paquetes individuales ("envíos flex" los maneja en
 * paralelo): FYM controla el turno de cada chofer — zona asignada, cantidad
 * de paquetes con la que salió, avances reportados cada 2-3 h, ubicación en
 * tiempo real y alertas de geocerca.
 */

/** Estado de un turno de chofer. */
export const SHIFT_STATUSES = ["ACTIVE", "ENDED"] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

/** Tipos de alerta generadas por el sistema de control. */
export const ZONE_ALERT_TYPES = ["LEFT_ZONE"] as const;
export type ZoneAlertType = (typeof ZONE_ALERT_TYPES)[number];

/** Estados de una alerta de zona. */
export const ZONE_ALERT_STATUSES = ["OPEN", "RESOLVED"] as const;
export type ZoneAlertStatus = (typeof ZONE_ALERT_STATUSES)[number];

/**
 * ⚙️ PARÁMETRO EDITABLE: intervalo entre avisos de avance (horas).
 * El chofer debe reportar el avance cada estas horas (pedido de Fede:
 * "cada 2-3 horas haga un aviso"). Se usa para calcular el próximo
 * aviso esperado y mostrarlo en el panel/PWA.
 */
export const REPORT_INTERVAL_HOURS = 2;

/**
 * Umbral (minutos) sin GPS del chofer antes de marcarlo como "sin señal"
 * en el panel (adaptación de GPS_SILENCE del sistema FYC).
 */
export const GPS_SILENCE_MINUTES = 5;

/** Umbral (minutos) sin reporte de avance antes de marcar "aviso vencido". */
export const REPORT_LATE_MINUTES = REPORT_INTERVAL_HOURS * 60 + 20;

/** Prefijo del QR de chofer (para distinguirlo de otros códigos). */
export const DRIVER_QR_PREFIX = "FYM-DRIVER-";
