import Anthropic from "@anthropic-ai/sdk";

/**
 * Verificación con IA de la captura de Flex del chofer (pedido de Fede:
 * "pago x paquete", necesita saber que la cantidad declarada es real).
 * Se llama desde `startShift()` justo después de subir la captura —
 * ver `services/shifts.ts`.
 *
 * Si `ANTHROPIC_API_KEY` no está configurada, degrada a "no disponible"
 * en vez de tirar una excepción: el turno arranca igual, pero queda
 * PENDING para que alguien del depósito lo confirme a mano (mismo camino
 * que cuando la IA no está segura o el número no coincide).
 */

export type PackageVerificationResult =
  | { status: "not_configured" }
  | {
      status: "analyzed";
      matched: boolean;
      detectedCount: number | null;
      confidence: "high" | "medium" | "low";
      reasoning: string;
    };

const MODEL = "claude-opus-5";

/** Cuán cerca tiene que estar lo detectado de lo declarado para
 * auto-aprobar — Flex a veces cuenta "envíos" distinto a "paquetes"
 * físicos (uno puede traer varios bultos), así que no exigimos exactitud
 * perfecta, solo que sea plausible. */
function isCloseEnough(detected: number, declared: number): boolean {
  if (detected === declared) return true;
  const diff = Math.abs(detected - declared);
  return diff <= Math.max(2, Math.round(declared * 0.1));
}

export async function verifyPackageScreenshot(
  imageBase64: string,
  mimeType: string,
  declaredCount: number,
): Promise<PackageVerificationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { status: "not_configured" };

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      "Sos un verificador automático para una empresa de reparto. Te muestran una " +
      "captura de pantalla de la app de Mercado Libre Flex (la lista de envíos " +
      "asignados a un chofer) y la cantidad de paquetes que el chofer DECLARÓ " +
      "llevar. Tu trabajo es leer la captura y decidir si la cantidad declarada es " +
      "plausible. Respondé SOLO con un objeto JSON, sin texto antes ni después, con " +
      "esta forma exacta: " +
      '{"detectedCount": number | null, "confidence": "high" | "medium" | "low", ' +
      '"reasoning": string}. ' +
      "`detectedCount` es la cantidad de envíos/paquetes que contás en la captura " +
      "(null si la imagen no es una captura de Flex legible o no se puede contar). " +
      "`confidence` es tu confianza en ese conteo. `reasoning` es una frase corta " +
      "en español explicando qué viste.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType as "image/jpeg" | "image/png" | "image/webp",
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: `El chofer declaró ${declaredCount} paquetes. ¿Cuántos ves en la captura?`,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return {
      status: "analyzed",
      matched: false,
      detectedCount: null,
      confidence: "low",
      reasoning: "la IA no devolvió una respuesta de texto",
    };
  }

  let parsed: {
    detectedCount: number | null;
    confidence: "high" | "medium" | "low";
    reasoning: string;
  };
  try {
    // La IA a veces envuelve el JSON en ```json ... ``` pese a la
    // instrucción — se lo saca antes de parsear.
    const clean = textBlock.text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    parsed = JSON.parse(clean) as typeof parsed;
  } catch {
    return {
      status: "analyzed",
      matched: false,
      detectedCount: null,
      confidence: "low",
      reasoning: `la IA no devolvió JSON válido: ${textBlock.text.slice(0, 200)}`,
    };
  }

  const matched =
    parsed.confidence === "high" &&
    parsed.detectedCount != null &&
    isCloseEnough(parsed.detectedCount, declaredCount);

  return {
    status: "analyzed",
    matched,
    detectedCount: parsed.detectedCount,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
  };
}
