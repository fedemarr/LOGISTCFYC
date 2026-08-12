import { describe, expect, it } from "vitest";
import { hashNormalizedAddress, normalizeAddressText } from "../lib/normalize-address";

describe("normalizeAddressText", () => {
  it("baja a minúsculas y saca acentos", () => {
    expect(normalizeAddressText("Perú 880, Villa Ballester")).toBe(
      "peru 880, villa ballester",
    );
  });

  it("colapsa espacios múltiples", () => {
    expect(normalizeAddressText("Perú   880")).toBe("peru 880");
  });

  it("recorta espacios al inicio y al final", () => {
    expect(normalizeAddressText("  Perú 880  ")).toBe("peru 880");
  });
});

describe("hashNormalizedAddress", () => {
  it("da el mismo hash para variantes triviales de la misma dirección", async () => {
    const a = await hashNormalizedAddress("Perú 880, Villa Ballester");
    const b = await hashNormalizedAddress("  PERÚ   880,   Villa Ballester  ");
    expect(a).toBe(b);
  });

  it("da hashes distintos para direcciones distintas", async () => {
    const a = await hashNormalizedAddress("Perú 880, Villa Ballester");
    const b = await hashNormalizedAddress("Perú 881, Villa Ballester");
    expect(a).not.toBe(b);
  });

  it("es un hex de 64 caracteres (sha-256)", async () => {
    const hash = await hashNormalizedAddress("Perú 880");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
