import { describe, expect, it } from "vitest";
import { detectCodeFormat, parseBarcodePayload } from "../lib/barcode";

describe("detectCodeFormat", () => {
  it("detecta JSON como QR", () => {
    expect(detectCodeFormat('{"street":"Perú 880"}')).toBe("QR");
  });
  it("detecta delimitado con | como QR", () => {
    expect(detectCodeFormat("street=Peru 880|locality=Villa Ballester")).toBe("QR");
  });
  it("detecta EAN_13", () => {
    expect(detectCodeFormat("7791234567895")).toBe("EAN_13");
  });
  it("detecta CODE_128 para numéricos largos", () => {
    expect(detectCodeFormat("ML447180123")).toBe("OTHER"); // alfanumérico, no es solo dígitos
    expect(detectCodeFormat("447180123456")).toBe("CODE_128");
  });
  it("string vacío es OTHER", () => {
    expect(detectCodeFormat("   ")).toBe("OTHER");
  });
});

describe("parseBarcodePayload", () => {
  it("parsea JSON con dirección", () => {
    const result = parseBarcodePayload(
      '{"street":"Perú","number":"880","locality":"Villa Ballester","recipientName":"Juan Pérez"}',
    );
    expect(result).toMatchObject({
      street: "Perú",
      number: "880",
      locality: "Villa Ballester",
      recipientName: "Juan Pérez",
    });
  });

  it("parsea formato delimitado campo=valor|campo=valor", () => {
    const result = parseBarcodePayload("calle=Perú|numero=880|localidad=Villa Ballester");
    expect(result).toMatchObject({
      street: "Perú",
      number: "880",
      locality: "Villa Ballester",
    });
  });

  it("devuelve null para JSON sin campos de dirección reconocibles", () => {
    expect(parseBarcodePayload('{"foo":"bar"}')).toBeNull();
  });

  it("devuelve null para JSON inválido, no tira excepción", () => {
    expect(parseBarcodePayload("{not valid json")).toBeNull();
  });

  it("devuelve null para un código simple sin estructura", () => {
    expect(parseBarcodePayload("ML4471829")).toBeNull();
  });

  it("devuelve null para string vacío", () => {
    expect(parseBarcodePayload("")).toBeNull();
  });
});
