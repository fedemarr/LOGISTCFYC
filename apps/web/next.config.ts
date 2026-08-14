import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los packages del monorepo se consumen como TS fuente (sin paso de
  // build propio), Next.js los transpila igual que a su propio código.
  transpilePackages: ["@fyc/shared", "@fyc/state-machine", "@fyc/geo"],
};

/**
 * Sentry (FASE 13 §8). Si no hay `SENTRY_DSN` configurado, `register()`
 * en `instrumentation.ts` no inicializa nada y el plugin solo agrega el
 * wrapper de build sin subir sourcemaps (sin `SENTRY_AUTH_TOKEN` no hay
 * upload). En producción setear DSN + AUTH_TOKEN en Vercel.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  disableLogger: true,
});
