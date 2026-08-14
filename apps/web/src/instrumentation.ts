import * as Sentry from "@sentry/nextjs";

/**
 * Instrumentación de Sentry (FASE 13 §8). `register()` corre al arrancar
 * el server de Next (y en edge si el runtime lo pide). Sin `SENTRY_DSN`
 * no inicializa nada: el sistema funciona igual sin Sentry, solo deja de
 * reportar.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
    });
  }
}
