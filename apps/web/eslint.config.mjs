import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import eslintConfigPrettier from "eslint-config-prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // PROMPT-MAESTRO §0: "NO uses `any`" / "NO uses console.log en producción"
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Scripts de CLI para humanos (migraciones, seed, diagnóstico) — no son
    // "producción" en el sentido de la regla §0.8 (que apunta a código que
    // sirve requests). Acá el console.log ES la interfaz del script.
    files: ["src/lib/db/migrate.ts", "src/lib/db/seed/**", "src/lib/db/verify.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Scripts de CLI para humanos (build local, smoke test de la API) — igual
    // que arriba, el console.log ES la interfaz.
    files: ["scripts/**"],
    rules: {
      "no-console": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  eslintConfigPrettier,
];

export default eslintConfig;
