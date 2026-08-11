import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Espejo del path alias `@/* -> ./src/*` de tsconfig.json (que
    // Next.js resuelve solo pero Vitest no conoce).
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Node en worker_threads (el pool "threads" por defecto) tiene un bug
    // conocido de resolución DNS intermitente en Windows (getaddrinfo
    // ENOENT para hosts fuera de caché, ej. la conexión directa a
    // Supabase). "forks" usa procesos hijo completos y no lo sufre.
    pool: "forks",
  },
  // Vitest (via Vite) intenta procesar postcss.config.mjs del proyecto al
  // arrancar aunque los tests no toquen CSS para nada, y ese config usa
  // el plugin de Tailwind v4 en un formato que el pipeline de PostCSS de
  // Vite no reconoce acá — se lo pisa vacío, los tests no necesitan CSS.
  css: {
    postcss: { plugins: [] },
  },
});
