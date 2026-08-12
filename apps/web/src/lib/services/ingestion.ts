/**
 * Cascada de resolución de destino — PROMPT-MAESTRO §2. El core del
 * sistema (esta capa) nunca sabe de dónde vino la dirección: recibe un
 * código crudo y devuelve un `ResolutionResult` normalizado.
 *
 * Orden exacto de la cascada (§2):
 *   1. MANIFEST           — el código ya está en un paquete pre-cargado
 *      (importado por CSV, §9.1) con dirección.
 *   2. BARCODE_PAYLOAD     — el código trae la dirección adentro (JSON o
 *      delimitado).
 *   3. ADDRESS_MEMORY      — este mismo código raw ya se escaneó y resolvió
 *      antes (en otra operación).
 *   4. OCR                 — texto reconocido on-device por
 *      `apps/mobile` (FASE 8, `expo-text-extractor`, ML Kit/Vision) sobre
 *      la foto de la etiqueta. El servidor NUNCA hace OCR — recibe las
 *      líneas de texto ya reconocidas y las parsea con
 *      `parseOcrAddressLines()` (`@fyc/shared`, compartido con mobile
 *      para que la lógica de parseo no se desincronice). Siempre
 *      confianza MEDIUM (§9.1: "mostrar foto + campos editables →
 *      confirmar"), nunca HIGH — es una heurística sobre texto con ruido,
 *      no una fuente estructurada como BARCODE_PAYLOAD.
 *   5. MANUAL              — bandeja de resolución humana (fallback final,
 *      "ningún paquete queda fuera del sistema").
 *
 * Antes de la cascada: chequeo de duplicado (§9.1, "código escaneado dos
 * veces") — no es un adapter, es una guarda.
 */
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import {
  detectCodeFormat,
  parseBarcodePayload,
  parseOcrAddressLines,
  type CodeFormat,
  type ParsedAddress,
  type ResolutionResult,
} from "@fyc/shared";
import type { PackageStatus } from "@fyc/state-machine";
import { db } from "@/lib/db";
import { clients, packageScans, packages } from "@/lib/db/schema";
import { runPackageTransition } from "./state-machine";
import type { AuthContext } from "@/lib/api/auth";

export interface ScanRequest {
  rawCode: string;
  codeFormat?: CodeFormat;
  operationId: string;
  clientId?: string;
  deviceId?: string;
  photoUrl?: string;
  /** Líneas de texto que reconoció el OCR on-device de `apps/mobile` sobre la foto de la etiqueta (§2 escalón 4). */
  ocrLines?: string[];
  lat?: number;
  lng?: number;
}

export interface ScanOutcome {
  packageId: string;
  internalCode: string;
  trackingCode: string;
  status: PackageStatus;
  resolution: ResolutionResult;
  duplicate: boolean;
  duplicateInfo?: { scannedBy: string; scannedAt: Date };
  wrongClient: boolean;
}

function formatParsedAddress(data: Partial<ParsedAddress>): string {
  const line1 = [data.street, data.number].filter(Boolean).join(" ");
  const line2 = [
    data.floor && `Piso ${data.floor}`,
    data.apartment && `Depto ${data.apartment}`,
  ]
    .filter(Boolean)
    .join(" ");
  const line3 = [data.locality, data.municipality].filter(Boolean).join(", ");
  return [line1, line2, line3].filter(Boolean).join(", ") || (data.rawText ?? "");
}

/** Código propio para etiqueta/QR (§7). Usado también por el importador CSV. */
export function generateInternalCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I, ambiguos en etiqueta
  let suffix = "";
  for (let i = 0; i < 7; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `ML-${suffix}`;
}

/**
 * Corre la cascada sobre un paquete que YA existe pero todavía no tiene
 * dirección (no vino con manifiesto, o el manifiesto no traía dirección).
 * No toca la base — es la parte pura de la cascada, testeable sin DB.
 */
export function resolveDestination(
  rawCode: string,
  photoUrl?: string,
  ocrLines?: string[],
): ResolutionResult {
  const payload = parseBarcodePayload(rawCode);
  if (payload) {
    return {
      resolved: true,
      source: "BARCODE_PAYLOAD",
      confidence: "HIGH",
      data: payload,
      rawEvidence: { rawCode },
    };
  }

  if (ocrLines && ocrLines.length > 0) {
    const parsed = parseOcrAddressLines(ocrLines);
    if (parsed) {
      // MEDIUM siempre (§9.1) — el chofer/depósito ya confirmó los campos
      // en la pantalla de confirmación antes de que esto llegue acá, pero
      // la fuente sigue siendo una heurística de OCR, no un dato
      // estructurado — la confianza refleja el ORIGEN, no si un humano lo
      // miró.
      return {
        resolved: true,
        source: "OCR",
        confidence: "MEDIUM",
        data: parsed,
        rawEvidence: { photoUrl, rawCode },
      };
    }
  }

  return {
    resolved: false,
    source: "MANUAL",
    confidence: "LOW",
    data: {},
    rawEvidence: photoUrl ? { photoUrl, rawCode } : { rawCode },
  };
}

/**
 * Escanea un código: identidad + cascada de destino. La escritura de
 * paquete+scan va en una transacción propia; la transición de estado la
 * hace `runPackageTransition()` en la suya (abre `db.transaction()` sobre
 * la conexión compartida — anidarla acá adentro de otra causaría que dos
 * conexiones del pool esperen el mismo lock de fila entre sí). Si el
 * paso de transición falla después de haber guardado la dirección, el
 * paquete queda con los datos completos pero todavía en
 * `PENDIENTE_RESOLUCION` — un estado recuperable, no una corrupción: se
 * puede reintentar la transición sin perder nada.
 */
export async function scanPackage(
  ctx: AuthContext,
  req: ScanRequest,
): Promise<ScanOutcome> {
  const codeFormat = req.codeFormat ?? detectCodeFormat(req.rawCode);

  const written = await db.transaction(async (tx) => {
    // ── Duplicado: ¿este código ya se escaneó en esta operación? (§9.1) ──
    const [previousScan] = await tx
      .select({
        packageId: packageScans.packageId,
        scannedBy: packageScans.scannedBy,
        scannedAt: packageScans.scannedAt,
      })
      .from(packageScans)
      .innerJoin(packages, eq(packages.id, packageScans.packageId))
      .where(
        and(
          eq(packageScans.rawCode, req.rawCode),
          eq(packages.operationId, req.operationId),
          isNotNull(packageScans.packageId),
        ),
      )
      .orderBy(desc(packageScans.scannedAt))
      .limit(1);

    if (previousScan?.packageId) {
      const [pkg] = await tx
        .select({
          id: packages.id,
          internalCode: packages.internalCode,
          trackingCode: packages.trackingCode,
          status: packages.status,
        })
        .from(packages)
        .where(eq(packages.id, previousScan.packageId));
      if (!pkg) throw new Error("scan previo referencia un paquete inexistente");

      await tx.insert(packageScans).values({
        packageId: pkg.id,
        orgId: ctx.orgId,
        rawCode: req.rawCode,
        codeFormat,
        scannedBy: ctx.userId,
        deviceId: req.deviceId,
        lat: req.lat,
        lng: req.lng,
        scanContext: "INTAKE",
        photoUrl: req.photoUrl,
      });

      const resolution: ResolutionResult = {
        resolved: true,
        source: "MANIFEST",
        confidence: "HIGH",
        data: {},
      };
      return {
        packageId: pkg.id,
        internalCode: pkg.internalCode,
        trackingCode: pkg.trackingCode ?? req.rawCode,
        status: pkg.status,
        resolution,
        duplicate: true as const,
        duplicateInfo: {
          scannedBy: previousScan.scannedBy ?? "",
          scannedAt: previousScan.scannedAt,
        },
        wrongClient: false,
        needsTransition: false,
      };
    }

    // ── Identidad: ¿coincide con un paquete pre-cargado (manifiesto)? ──
    const [manifestMatch] = await tx
      .select()
      .from(packages)
      .where(
        and(
          eq(packages.trackingCode, req.rawCode),
          eq(packages.operationId, req.operationId),
        ),
      );

    let pkg = manifestMatch;
    let resolution: ResolutionResult;

    if (pkg?.rawAddressText) {
      // Ya vino con dirección desde el CSV — HIGH directo, adapter MANIFEST.
      resolution = {
        resolved: true,
        source: "MANIFEST",
        confidence: "HIGH",
        data: { rawText: pkg.rawAddressText },
      };
    } else {
      // No hay manifiesto (o no traía dirección): sigue la cascada 2-5.
      resolution = resolveDestination(req.rawCode, req.photoUrl, req.ocrLines);

      // ADDRESS_MEMORY (escalón 3): ¿este código raw se resolvió antes,
      // en otra operación?
      if (!resolution.resolved) {
        const [memory] = await tx
          .select({ rawAddressText: packages.rawAddressText })
          .from(packages)
          .innerJoin(packageScans, eq(packageScans.packageId, packages.id))
          .where(
            and(
              eq(packageScans.rawCode, req.rawCode),
              ne(packages.operationId, req.operationId),
              isNotNull(packages.rawAddressText),
            ),
          )
          .orderBy(desc(packageScans.scannedAt))
          .limit(1);

        if (memory?.rawAddressText) {
          resolution = {
            resolved: true,
            source: "ADDRESS_MEMORY",
            confidence: "HIGH",
            data: { rawText: memory.rawAddressText },
          };
        }
      }
    }

    if (!pkg) {
      const [created] = await tx
        .insert(packages)
        .values({
          orgId: ctx.orgId,
          clientId: req.clientId,
          operationId: req.operationId,
          trackingCode: req.rawCode,
          internalCode: generateInternalCode(),
          status: "PENDIENTE_RESOLUCION",
        })
        .returning();
      if (!created) throw new Error("no se pudo crear el paquete");
      pkg = created;
    }

    // Wrong client (§9.1): el prefijo del código no coincide con el del
    // cliente esperado. No bloquea la ingesta, solo se informa.
    let wrongClient = false;
    if (req.clientId) {
      const [client] = await tx
        .select({ codePrefix: clients.codePrefix })
        .from(clients)
        .where(eq(clients.id, req.clientId));
      if (client?.codePrefix && !req.rawCode.startsWith(client.codePrefix)) {
        wrongClient = true;
      }
    }

    if (resolution.resolved) {
      const rawAddressText =
        resolution.data.rawText ?? formatParsedAddress(resolution.data);
      await tx
        .update(packages)
        .set({
          rawAddressText,
          destinationSource: resolution.source,
          destinationConfidence: resolution.confidence,
          recipientName: resolution.data.recipientName ?? pkg.recipientName,
          recipientPhone: resolution.data.recipientPhone ?? pkg.recipientPhone,
          updatedAt: new Date(),
        })
        .where(eq(packages.id, pkg.id));
    }

    await tx.insert(packageScans).values({
      packageId: pkg.id,
      orgId: ctx.orgId,
      rawCode: req.rawCode,
      codeFormat,
      scannedBy: ctx.userId,
      deviceId: req.deviceId,
      lat: req.lat,
      lng: req.lng,
      scanContext: "INTAKE",
      photoUrl: req.photoUrl,
      ocrRawText: req.ocrLines?.join("\n"),
    });

    const needsTransition = resolution.resolved && pkg.status === "PENDIENTE_RESOLUCION";

    return {
      packageId: pkg.id,
      internalCode: pkg.internalCode,
      trackingCode: pkg.trackingCode ?? req.rawCode,
      status: pkg.status,
      resolution,
      duplicate: false as const,
      wrongClient,
      needsTransition,
    };
  });

  if (!written.duplicate && written.needsTransition) {
    const result = await runPackageTransition({
      packageId: written.packageId,
      toStatus: "RECIBIDO",
      actorId: ctx.userId,
      actorRoles: ctx.roles,
      metadata: {
        source: written.resolution.source,
        confidence: written.resolution.confidence,
      },
    });
    return { ...written, status: result.toStatus };
  }

  return written;
}
