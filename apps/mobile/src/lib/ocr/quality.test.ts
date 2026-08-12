import { describe, expect, it } from "vitest";
import { assessOcrQuality } from "./quality";

describe("assessOcrQuality", () => {
  it("rechaza cuando no hay texto reconocido (foto borrosa/vacía)", () => {
    expect(assessOcrQuality([])).toEqual({ ok: false, reason: "no_text" });
    expect(assessOcrQuality(["", "  "])).toEqual({ ok: false, reason: "no_text" });
  });

  it("rechaza cuando el texto reconocido es demasiado corto para ser útil", () => {
    expect(assessOcrQuality(["ab"])).toEqual({ ok: false, reason: "no_text" });
  });

  it("acepta cuando hay suficiente texto reconocido", () => {
    expect(assessOcrQuality(["Perú 880", "Villa Ballester"])).toEqual({ ok: true });
  });
});
