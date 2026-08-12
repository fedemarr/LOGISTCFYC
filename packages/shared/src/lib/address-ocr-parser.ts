import type { ParsedAddress } from "../types/ingestion";

/**
 * Adaptador OCR (§2, escalón 4 de la cascada, deferred desde FASE 5 —
 * ver docs/DECISIONES.md ADR-029, implementado en FASE 8). Recibe las
 * LÍNEAS de texto que reconoció el OCR on-device de `apps/mobile`
 * (`expo-text-extractor`, que no da confianza por línea) y arma un
 * `ParsedAddress` best-effort — SIEMPRE a confianza MEDIUM (§9.1: "Si
 * resolvió con MEDIUM (OCR) → mostrar foto + campos editables →
 * confirmar"), nunca HIGH: es una heurística sobre texto de OCR real,
 * con ruido, no una fuente estructurada como BARCODE_PAYLOAD.
 *
 * Es una heurística basada en el orden típico de una etiqueta argentina
 * de e-commerce (nombre → calle y altura → piso/depto → localidad →
 * teléfono), NO un parser NLP. Documentado con sus límites conocidos —
 * ver los comentarios de cada regex.
 */

/**
 * Detección de teléfono por DENSIDAD de dígitos, no por prefijo exacto —
 * los formatos argentinos reales ("011-1534567890", "11 3456-7890",
 * "+54 9 11 3456-7890") varían demasiado en cómo combinan código de área
 * + marcador "15" de celular + número como para listar cada combinación
 * a mano. Cualquier tramo de 8 a 13 dígitos (separadores de por medio)
 * se toma como teléfono — ancho suficiente para cubrir con y sin código
 * de país/área, angosto para no confundir con una altura de calle.
 */
const PHONE_CANDIDATE_REGEX = /\+?\d[\d\s.-]{6,14}\d/;

/** "Piso 3", "Piso 3°", "PB" (planta baja, sin número). */
const FLOOR_REGEX = /\bpiso\.?\s*([0-9a-záéíóúñ]+°?)/i;
const PLANTA_BAJA_REGEX = /\bpb\b|\bplanta\s*baja\b/i;

/** "Depto B", "Dpto. 2", "Departamento A". */
const APARTMENT_REGEX = /\b(?:depto|dpto|departamento)\.?\s*([a-z0-9]+)/i;

/**
 * Calle + altura al final de la línea: "Av. San Martín 1234" → calle="Av.
 * San Martín", altura="1234". Límite conocido: también matchea cualquier
 * línea que termine en un número de 1 a 6 dígitos aunque no sea una
 * calle (ej. un código postal suelto) — por eso se evalúa DESPUÉS de
 * descartar teléfono/piso/depto, y solo se toma la primera línea que
 * matchea.
 */
const STREET_NUMBER_REGEX = /^(.+?)\s+(\d{1,6})\s*$/;

/** Devuelve solo los dígitos si la cantidad es consistente con un teléfono argentino (8 a 13 dígitos); `null` si no. */
function extractPhoneDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 13 ? digits : null;
}

/**
 * Parsea las líneas reconocidas por OCR en una `ParsedAddress`. Devuelve
 * `null` si no encuentra una línea con forma de "calle + altura" — sin
 * eso no hay nada confiable que ofrecerle al operador para confirmar, y
 * cae a la bandeja de resolución manual (§2, escalón 5) igual que
 * cualquier otro fallo de la cascada.
 */
export function parseOcrAddressLines(lines: string[]): ParsedAddress | null {
  const cleaned = lines.map((l) => l.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;

  let phone: string | undefined;
  let floor: string | undefined;
  let apartment: string | undefined;
  let street: string | undefined;
  let number: string | undefined;
  const before: string[] = [];
  const after: string[] = [];
  let seenStreet = false;

  for (const line of cleaned) {
    const phoneCandidate = PHONE_CANDIDATE_REGEX.exec(line);
    const phoneDigits = phoneCandidate ? extractPhoneDigits(phoneCandidate[0]) : null;
    if (phoneDigits) {
      phone = phoneDigits;
      continue;
    }

    const floorMatch = FLOOR_REGEX.exec(line);
    const aptMatch = APARTMENT_REGEX.exec(line);
    const isPlantaBaja = PLANTA_BAJA_REGEX.test(line);
    if (floorMatch || aptMatch || isPlantaBaja) {
      if (floorMatch?.[1]) floor = floorMatch[1].trim();
      else if (isPlantaBaja) floor = "PB";
      if (aptMatch?.[1]) apartment = aptMatch[1].trim();
      seenStreet = true; // piso/depto siempre va después de la calle en una etiqueta real
      continue;
    }

    if (!street) {
      const streetMatch = STREET_NUMBER_REGEX.exec(line);
      const streetPart = streetMatch?.[1];
      const numberPart = streetMatch?.[2];
      if (streetPart && numberPart) {
        street = streetPart.trim();
        number = numberPart.trim();
        seenStreet = true;
        continue;
      }
    }

    (seenStreet ? after : before).push(line);
  }

  if (!street) return null;

  return {
    rawText: cleaned.join(", "),
    street,
    number,
    floor,
    apartment,
    // Heurística de orden: lo que aparece ANTES de la calle suele ser el
    // nombre del destinatario; lo que aparece DESPUÉS suele ser la
    // localidad — orden típico de una etiqueta de e-commerce argentina.
    recipientName: before[0],
    locality: after[0],
    recipientPhone: phone,
  };
}
