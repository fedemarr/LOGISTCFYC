import { defineConfig } from "vitest/config";

// PROMPT-MAESTRO §14 (FASE 3): "cobertura de tests > 80% en la máquina de
// estados" es criterio de aceptación explícito — se mide, no se asume.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**"],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
