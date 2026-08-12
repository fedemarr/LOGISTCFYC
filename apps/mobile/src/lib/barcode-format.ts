import type { BarcodeType } from "expo-camera";
import type { CodeFormat } from "@fyc/shared";

/** `expo-camera` reconoce más formatos de los que modela `CODE_FORMATS` (`@fyc/shared`) — todo lo que no mapea cae en `OTHER`, nunca se pierde el escaneo. */
const MAP: Partial<Record<BarcodeType, CodeFormat>> = {
  qr: "QR",
  code128: "CODE_128",
  code39: "CODE_39",
  pdf417: "PDF417",
  datamatrix: "DATA_MATRIX",
  ean13: "EAN_13",
};

export function mapBarcodeType(type: string): CodeFormat {
  return MAP[type as BarcodeType] ?? "OTHER";
}
