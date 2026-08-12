/**
 * Heurística de "foto borrosa/ilegible" (§14 FASE 8: "rechazo de fotos
 * borrosas"). NO hay análisis de píxeles (varianza de Laplaciano) en este
 * alcance — requeriría acceso al buffer de píxeles de la imagen
 * (`expo-image-manipulator` + procesamiento manual), una pieza de
 * ingeniería separada. En su lugar: si el OCR on-device no reconoce
 * suficiente texto, la foto casi seguro está borrosa, mal encuadrada o
 * con poca luz — es la señal más barata y honesta disponible con las
 * piezas ya instaladas, y el resultado observable para el operador es el
 * mismo ("no se pudo leer, reintentá"). Documentado como limitación real
 * — ver docs/DECISIONES.md FASE 8.
 */
const MIN_RECOGNIZED_CHARS = 6;

export interface PhotoQualityResult {
  ok: boolean;
  reason?: "no_text";
}

export function assessOcrQuality(lines: string[]): PhotoQualityResult {
  const totalChars = lines.join("").replace(/\s/g, "").length;
  if (totalChars < MIN_RECOGNIZED_CHARS) {
    return { ok: false, reason: "no_text" };
  }
  return { ok: true };
}
