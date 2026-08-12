import { describe, expect, it } from "vitest";
import { parseOcrAddressLines } from "../lib/address-ocr-parser";

describe("parseOcrAddressLines", () => {
  it("parsea una etiqueta típica: nombre, calle+altura, piso/depto, localidad, teléfono", () => {
    const result = parseOcrAddressLines([
      "Juan Pérez",
      "Av. San Martín 1234",
      "Piso 3 Depto B",
      "Villa Ballester",
      "011-1534567890",
    ]);
    expect(result).toEqual({
      rawText:
        "Juan Pérez, Av. San Martín 1234, Piso 3 Depto B, Villa Ballester, 011-1534567890",
      street: "Av. San Martín",
      number: "1234",
      floor: "3",
      apartment: "B",
      recipientName: "Juan Pérez",
      locality: "Villa Ballester",
      recipientPhone: "0111534567890",
    });
  });

  it("sin piso ni depto ni teléfono, solo calle y localidad", () => {
    const result = parseOcrAddressLines(["Perú 880", "Villa Ballester"]);
    expect(result?.street).toBe("Perú");
    expect(result?.number).toBe("880");
    expect(result?.locality).toBe("Villa Ballester");
    expect(result?.floor).toBeUndefined();
    expect(result?.apartment).toBeUndefined();
  });

  it("reconoce PB (planta baja) sin número de piso", () => {
    const result = parseOcrAddressLines(["Alvear 1502", "PB", "San Martín"]);
    expect(result?.floor).toBe("PB");
  });

  it("sin una línea con forma de calle+altura, devuelve null (cae a MANUAL)", () => {
    expect(parseOcrAddressLines(["Villa Ballester", "011-1534567890"])).toBeNull();
    expect(parseOcrAddressLines([])).toBeNull();
    expect(parseOcrAddressLines(["   ", ""])).toBeNull();
  });

  it("reconoce el teléfono en distintos formatos argentinos comunes", () => {
    const formats = [
      "011-1534567890",
      "11 3456-7890",
      "15-3456-7890",
      "+54 9 11 3456-7890",
    ];
    for (const phone of formats) {
      const result = parseOcrAddressLines(["Perú 880", "Villa Ballester", phone]);
      expect(result?.recipientPhone).toBeTruthy();
    }
  });

  it("con varias líneas antes/después de la calle, toma la primera de cada lado", () => {
    const result = parseOcrAddressLines([
      "Depósito FYC",
      "Juan Pérez",
      "Perú 880",
      "Villa Ballester",
      "Buenos Aires",
    ]);
    expect(result?.recipientName).toBe("Depósito FYC");
    expect(result?.locality).toBe("Villa Ballester");
  });
});
