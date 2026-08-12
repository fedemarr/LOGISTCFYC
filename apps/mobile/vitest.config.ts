import { defineConfig } from "vitest/config";

/**
 * Vitest acá SOLO corre la lógica pura de `src/lib/**` (sin imports de
 * React Native) — outbox, backoff, mapeo de payloads. Las pantallas/
 * componentes de Expo Router no se testean con Vitest (necesitarían
 * jest-expo + mocks nativos, fuera de alcance de FASE 7); se verifican
 * con `pnpm typecheck`/`pnpm lint` + revisión manual en el dispositivo.
 */
export default defineConfig({
  test: {
    include: ["src/lib/**/*.test.ts"],
    environment: "node",
  },
});
