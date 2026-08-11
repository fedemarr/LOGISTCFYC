// @ts-check
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/**
 * Config base de ESLint (flat config) compartida por todos los packages
 * que no son Next.js ni React Native. Reglas duras porque no negociamos
 * `any` ni `console.log` en el código de dominio (ver PROMPT-MAESTRO §0).
 */
export const baseConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    ignores: ["dist/**", "build/**", ".turbo/**", "node_modules/**"],
  },
  eslintConfigPrettier,
);

export default baseConfig;
