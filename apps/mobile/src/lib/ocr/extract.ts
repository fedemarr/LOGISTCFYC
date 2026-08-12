import { extractTextFromImage, isSupported } from "expo-text-extractor";

export { isSupported };

/**
 * OCR on-device (§14 FASE 8: "ML Kit" en Android, Apple Vision en iOS vía
 * `expo-text-extractor` — ver docs/DECISIONES.md para por qué se eligió
 * este paquete). Nunca tira: si el dispositivo no soporta OCR o falla el
 * reconocimiento, devuelve un array vacío — el caller lo trata igual que
 * "no se pudo leer nada" (cae a la bandeja manual, nunca bloquea).
 */
export async function extractLabelText(photoUri: string): Promise<string[]> {
  if (!isSupported) return [];
  try {
    return await extractTextFromImage(photoUri);
  } catch {
    return [];
  }
}
