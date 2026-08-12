import type { CodeFormat, ParsedAddress } from "../types/ingestion";

/**
 * Heurística de detección de formato a partir del string crudo — útil
 * tanto en el importador CSV (que puede no traer el formato) como en el
 * escaneo real de `apps/mobile` (FASE 8), que si sabe el formato porque lo
 * da el SDK de cámara. Nunca se usa para "limpiar" el código — el crudo se
 * guarda siempre tal cual llegó (§2).
 */
export function detectCodeFormat(raw: string): CodeFormat {
  const trimmed = raw.trim();
  if (!trimmed) return "OTHER";
  if (/^\{.*\}$/.test(trimmed) || trimmed.includes("|")) return "QR";
  if (/^\d{13}$/.test(trimmed)) return "EAN_13";
  if (/^\d{6,20}$/.test(trimmed)) return "CODE_128";
  return "OTHER";
}

/**
 * Adaptador BARCODE_PAYLOAD (§2, escalón 2 de la cascada): el código trae
 * la dirección adentro, en JSON o en un formato delimitado
 * `campo=valor|campo=valor`. Devuelve `null` si no es parseable — nunca
 * tira excepción, la cascada sigue al escalón siguiente.
 */
export function parseBarcodePayload(raw: string): ParsedAddress | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed) as Record<string, unknown>;
      const address = extractAddressFields(json);
      return address ? { ...address, rawText: trimmed } : null;
    } catch {
      return null;
    }
  }

  if (trimmed.includes("|") && trimmed.includes("=")) {
    const fields: Record<string, string> = {};
    for (const pair of trimmed.split("|")) {
      const [key, ...rest] = pair.split("=");
      if (!key || rest.length === 0) continue;
      fields[key.trim().toLowerCase()] = rest.join("=").trim();
    }
    const address = extractAddressFields(fields);
    return address ? { ...address, rawText: trimmed } : null;
  }

  return null;
}

function extractAddressFields(
  source: Record<string, unknown>,
): Omit<ParsedAddress, "rawText"> | null {
  const get = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = source[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  };

  const street = get("street", "calle");
  const locality = get("locality", "localidad", "city");
  if (!street && !locality) return null; // no parece traer una dirección

  return {
    street,
    number: get("number", "numero", "altura"),
    floor: get("floor", "piso"),
    apartment: get("apartment", "depto", "dpto"),
    locality,
    municipality: get("municipality", "partido"),
    province: get("province", "provincia"),
    postalCode: get("postalCode", "cp"),
    recipientName: get("recipientName", "destinatario", "name"),
    recipientPhone: get("recipientPhone", "telefono", "phone"),
  };
}
