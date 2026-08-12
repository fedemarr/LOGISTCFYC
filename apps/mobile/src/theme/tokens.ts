/**
 * Design tokens de la app del chofer — espejo en JS de
 * `packages/config/tailwind/tokens.css` (el panel web). React Native no
 * tiene CSS custom properties, así que esto es la fuente de verdad para
 * mobile; si el panel cambia un color, este archivo se actualiza a mano
 * (documentado, no hay forma de compartir CSS con RN en este stack).
 *
 * Dark mode es OBLIGATORIO acá (PROMPT-MAESTRO §13: "el contexto de uso
 * es sol directo" — alto contraste, nunca depende del tema del sistema),
 * a diferencia del panel web que sí tiene ambos temas de primera clase.
 */

export const colors = {
  bg: "#0F1115",
  surface: "#171A21",
  surface2: "#1F232C",
  surface3: "#272C37",
  border: "#2A2F3A",
  border2: "#373D4A",
  text: "#E8EAED",
  muted: "#8B919E",
  muted2: "#646B79",

  pending: "#8B919E",
  active: "#3B82F6",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#EF4444",
  info: "#A855F7",
} as const;

/** Paleta de rutas — 12 colores fijos por índice (mismo orden que el panel web, §2). */
export const routeColors = [
  "#0EA5E9",
  "#A855F7",
  "#22C55E",
  "#EAB308",
  "#F97316",
  "#EC4899",
  "#14B8A6",
  "#6366F1",
  "#84CC16",
  "#F43F5E",
  "#06B6D4",
  "#8B5CF6",
] as const;

export function routeColor(routeNumber: number): string {
  return routeColors[(routeNumber - 1) % routeColors.length] ?? colors.muted;
}

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/**
 * Tipografía (§2/§13): Archivo para interfaz, JetBrains Mono para todo
 * dato operativo (bultos, códigos, km, horas — cifras tabulares). Los
 * nombres de familia son los que registra `expo-font` en
 * `app/_layout.tsx` vía `@expo-google-fonts/*`.
 */
export const fonts = {
  sans: "Archivo_400Regular",
  sansMedium: "Archivo_500Medium",
  sansSemibold: "Archivo_600SemiBold",
  sansBold: "Archivo_700Bold",
  mono: "JetBrainsMono_400Regular",
  monoMedium: "JetBrainsMono_500Medium",
  monoBold: "JetBrainsMono_700Bold",
} as const;

/**
 * Restricciones duras de la app del chofer (§13): "sol directo, una
 * mano, apurado, a veces con guantes". No son un capricho de diseño —
 * son el número mínimo verificado para que un touch target no falle.
 */
export const touch = {
  minTarget: 56,
  primaryButton: 64,
  baseFontSize: 18,
} as const;
