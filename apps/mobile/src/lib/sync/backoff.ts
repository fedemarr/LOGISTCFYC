/**
 * Reintentos con backoff exponencial (§12): "5s, 15s, 1m, 5m, 15m, 1h".
 * Función pura — sin esto testeado, un bug acá significa "el chofer se
 * queda sin batería reintentando cada 5 segundos durante 8 horas" o
 * "una acción tarda 1 hora en el primer intento".
 */
const SCHEDULE_MS = [5_000, 15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

/** `attempts` = intentos fallidos ya hechos (0 = todavía no se intentó nunca). */
export function getBackoffDelayMs(attempts: number): number {
  const index = Math.max(0, Math.min(attempts, SCHEDULE_MS.length - 1));
  return SCHEDULE_MS[index]!;
}

export function getNextAttemptAt(attempts: number, now: Date = new Date()): string {
  return new Date(now.getTime() + getBackoffDelayMs(attempts)).toISOString();
}
