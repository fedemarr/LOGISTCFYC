/**
 * Tipos de la capa de ingesta — PROMPT-MAESTRO §2. El core del sistema
 * nunca sabe de dónde vino la dirección: todo pasa por este contrato.
 * Los enums acá son mirrors intencionales de los de
 * `apps/web/src/lib/db/schema/enums.ts` (mismo motivo que
 * @fyc/state-machine, ver docs/DECISIONES.md ADR-014): drizzle-kit no
 * puede importar paquetes del workspace, así que la Postgres truth vive
 * en el schema y estos tipos son el contrato de dominio compartido con
 * apps/mobile (que también escanea, FASE 8).
 */

export const CODE_FORMATS = [
  "QR",
  "CODE_128",
  "CODE_39",
  "PDF417",
  "DATA_MATRIX",
  "EAN_13",
  "OTHER",
  "MANUAL",
] as const;
export type CodeFormat = (typeof CODE_FORMATS)[number];

export const RESOLUTION_SOURCES = [
  "MANIFEST",
  "BARCODE_PAYLOAD",
  "OCR",
  "MANUAL",
  "ADDRESS_MEMORY",
] as const;
export type ResolutionSource = (typeof RESOLUTION_SOURCES)[number];

export const RESOLUTION_CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;
export type ResolutionConfidence = (typeof RESOLUTION_CONFIDENCES)[number];

/** Dirección ya parseada en sus partes, cualquiera sea el origen. */
export interface ParsedAddress {
  rawText: string;
  street?: string;
  number?: string;
  floor?: string;
  apartment?: string;
  locality?: string;
  municipality?: string;
  province?: string;
  postalCode?: string;
  recipientName?: string;
  recipientPhone?: string;
}

/** Lo que entra a la cascada: un código recién escaneado. */
export interface ScanInput {
  rawCode: string;
  codeFormat: CodeFormat;
  orgId: string;
  operationId: string;
  scannedBy: string;
  photoUrl?: string;
  lat?: number;
  lng?: number;
}

/** Lo que devuelve cada escalón de la cascada (§2). */
export interface ResolutionResult {
  resolved: boolean;
  source: ResolutionSource;
  confidence: ResolutionConfidence;
  data: Partial<ParsedAddress> & { packageId?: string; trackingCode?: string };
  rawEvidence?: { photoUrl?: string; rawCode: string };
}
