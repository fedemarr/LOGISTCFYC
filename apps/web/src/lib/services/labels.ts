/**
 * Generación de etiquetas — PROMPT-MAESTRO §9.2. Formato exacto pedido en
 * el documento madre:
 *
 *   RUTA 002 · BULTO 17           ← grande, legible a 2 m
 *   ══════════════════════        ← banda de color de la ruta
 *   Av. San Martín 1234           ← grande, legible a 1 m
 *   Piso 3 Depto B
 *   Villa Ballester                ← mediano
 *   Juan Pérez
 *   [QR interno]      #ML-4471829 ← chico
 *
 * El QR es SIEMPRE `packages.internal_code`, nunca el código del
 * proveedor (§9.2: "así el sistema controla qué significa cada código").
 * Solo se puede imprimir de una ruta `APPROVED` — antes de aprobar,
 * `bulk_number` todavía no está congelado (§7) y la etiqueta mentiría.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { asc, eq } from "drizzle-orm";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { packages, routes, routeStops } from "@/lib/db/schema";

export type LabelFormat = "thermal" | "a4";

const MM_TO_PT = 2.834645669;
const mm = (value: number): number => value * MM_TO_PT;

interface LabelData {
  routeNumber: number;
  bulkNumber: number;
  colorHex: string;
  addressLines: string[];
  recipientName: string;
  internalCode: string;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return {
    r: Number.isNaN(r) ? 0 : r,
    g: Number.isNaN(g) ? 0 : g,
    b: Number.isNaN(b) ? 0 : b,
  };
}

function splitAddress(raw: string | null): string[] {
  if (!raw) return ["(sin dirección)"];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

async function fetchLabelData(orgId: string, routeId: string): Promise<LabelData[]> {
  const [route] = await db.select().from(routes).where(eq(routes.id, routeId));
  if (!route || route.orgId !== orgId) throw Errors.notFound("ruta no encontrada");
  if (route.status !== "APPROVED") {
    throw Errors.validation(
      "solo se pueden imprimir etiquetas de una ruta APROBADA — el número de bulto todavía no está congelado",
    );
  }

  const stops = await db
    .select({
      bulkNumber: packages.bulkNumber,
      internalCode: packages.internalCode,
      recipientName: packages.recipientName,
      rawAddressText: packages.rawAddressText,
    })
    .from(routeStops)
    .innerJoin(packages, eq(packages.id, routeStops.packageId))
    .where(eq(routeStops.routeId, routeId))
    .orderBy(asc(routeStops.sequence));

  return stops
    .filter((s): s is typeof s & { bulkNumber: number } => s.bulkNumber != null)
    .map((s) => ({
      routeNumber: route.routeNumber,
      bulkNumber: s.bulkNumber,
      colorHex: route.colorHex ?? "#2563EB",
      addressLines: splitAddress(s.rawAddressText),
      recipientName: s.recipientName ?? "(destinatario a confirmar)",
      internalCode: s.internalCode,
    }));
}

async function drawLabel(
  page: PDFPage,
  data: LabelData,
  origin: { x: number; y: number },
  size: { w: number; h: number },
  fonts: { bold: PDFFont; regular: PDFFont; mono: PDFFont },
): Promise<void> {
  const { x, y } = origin;
  const { w, h } = size;
  const pad = mm(4);
  const color = hexToRgb(data.colorHex);

  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: rgb(0.7, 0.7, 0.7),
    borderWidth: 1,
  });

  let cursorY = y + h - pad - 14;
  page.drawText(
    `RUTA ${String(data.routeNumber).padStart(3, "0")} · BULTO ${data.bulkNumber}`,
    {
      x: x + pad,
      y: cursorY,
      size: 16,
      font: fonts.bold,
    },
  );

  cursorY -= mm(3);
  page.drawRectangle({
    x: x + pad,
    y: cursorY,
    width: w - pad * 2,
    height: mm(2.5),
    color: rgb(color.r, color.g, color.b),
  });

  cursorY -= mm(9);
  for (const [i, line] of data.addressLines.entries()) {
    page.drawText(line, {
      x: x + pad,
      y: cursorY,
      size: i === 0 ? 15 : 11,
      font: i === 0 ? fonts.bold : fonts.regular,
    });
    cursorY -= mm(i === 0 ? 7 : 5.5);
  }

  cursorY -= mm(3);
  page.drawText(data.recipientName, {
    x: x + pad,
    y: cursorY,
    size: 11,
    font: fonts.regular,
  });

  // QR interno (§9.2) + código chico, abajo.
  const qrSizePt = mm(18);
  const qrDataUrl = await QRCode.toDataURL(data.internalCode, { margin: 0 });
  const qrBytes = Buffer.from(qrDataUrl.split(",")[1] ?? "", "base64");
  const qrImage = await page.doc.embedPng(qrBytes);
  const qrY = y + pad;
  page.drawImage(qrImage, { x: x + pad, y: qrY, width: qrSizePt, height: qrSizePt });
  page.drawText(`#${data.internalCode}`, {
    x: x + pad + qrSizePt + mm(3),
    y: qrY + qrSizePt / 2 - 4,
    size: 9,
    font: fonts.mono,
  });
}

/** PDF térmica: una etiqueta de 100×150mm por página (§9.2). */
export async function generateThermalLabelsPdf(
  orgId: string,
  routeId: string,
): Promise<Uint8Array> {
  const labels = await fetchLabelData(orgId, routeId);
  const doc = await PDFDocument.create();
  const fonts = {
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    regular: await doc.embedFont(StandardFonts.Helvetica),
    mono: await doc.embedFont(StandardFonts.Courier),
  };

  const w = mm(100);
  const h = mm(150);
  for (const label of labels) {
    const page = doc.addPage([w, h]);
    await drawLabel(page, label, { x: 0, y: 0 }, { w, h }, fonts);
  }

  return doc.save();
}

/** PDF A4 autoadhesiva: grilla de 2×2 etiquetas por hoja (§9.2). */
export async function generateA4LabelsPdf(
  orgId: string,
  routeId: string,
): Promise<Uint8Array> {
  const labels = await fetchLabelData(orgId, routeId);
  const doc = await PDFDocument.create();
  const fonts = {
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    regular: await doc.embedFont(StandardFonts.Helvetica),
    mono: await doc.embedFont(StandardFonts.Courier),
  };

  const pageW = mm(210);
  const pageH = mm(297);
  const margin = mm(5);
  const cols = 2;
  const rows = 2;
  const cellW = (pageW - margin * (cols + 1)) / cols;
  const cellH = (pageH - margin * (rows + 1)) / rows;

  let page: PDFPage | null = null;
  for (let i = 0; i < labels.length; i++) {
    const slot = i % (cols * rows);
    if (slot === 0) page = doc.addPage([pageW, pageH]);
    if (!page) continue;

    const col = slot % cols;
    const rowFromTop = Math.floor(slot / cols);
    const x = margin + col * (cellW + margin);
    const y = pageH - margin - (rowFromTop + 1) * cellH - rowFromTop * margin;

    await drawLabel(page, labels[i]!, { x, y }, { w: cellW, h: cellH }, fonts);
  }

  return doc.save();
}

export async function generateRouteLabelsPdf(
  orgId: string,
  routeId: string,
  format: LabelFormat,
): Promise<Uint8Array> {
  return format === "thermal"
    ? generateThermalLabelsPdf(orgId, routeId)
    : generateA4LabelsPdf(orgId, routeId);
}
