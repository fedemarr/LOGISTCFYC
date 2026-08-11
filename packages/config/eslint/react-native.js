// @ts-check
import expoConfig from "eslint-config-expo/flat.js";
import eslintConfigPrettier from "eslint-config-prettier";

/**
 * Config de ESLint para apps/mobile: parte de la config oficial de Expo
 * (soporta JSX, react-hooks, react-native) y le suma las mismas reglas
 * duras del resto del monorepo (nada de `any`, nada de `console.log`
 * suelto en producción).
 */
export const reactNativeConfig = [
  ...expoConfig,
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Restringido a ts/tsx: el plugin @typescript-eslint solo está
    // registrado por eslint-config-expo para esos archivos, no para los
    // .js sueltos del proyecto (metro.config.js, babel.config.js, etc.).
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    ignores: ["dist/**", ".expo/**", ".turbo/**", "node_modules/**"],
  },
  eslintConfigPrettier,
];

export default reactNativeConfig;
