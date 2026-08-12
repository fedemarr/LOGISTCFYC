/**
 * Normalización de direcciones argentinas — fuente única para
 * `known_addresses.normalized_hash` (§2, memoria de direcciones). La usan
 * tanto el seed (FASE 2) como el servicio de geocoding (FASE 5): antes
 * estaba duplicada en `apps/web/src/lib/db/seed/index.ts`, se centraliza acá.
 *
 * No es un normalizador exhaustivo de direcciones argentinas (abreviaturas
 * de "Av."/"Avenida", "Bs. As.", etc.) — eso es una mejora futura. Por ahora
 * normaliza lo suficiente para deduplicar variantes triviales (mayúsculas,
 * acentos, espacios).
 */
export function normalizeAddressText(rawText: string): string {
  return rawText
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca acentos (rango real de diacríticos Unicode)
    .replace(/\s+/g, " ")
    .trim();
}

/** Hash determinístico (SHA-256, hex) de la dirección normalizada. */
export async function hashNormalizedAddress(rawText: string): Promise<string> {
  const normalized = normalizeAddressText(rawText);
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
