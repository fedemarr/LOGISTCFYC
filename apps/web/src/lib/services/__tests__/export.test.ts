import { describe, expect, it } from "vitest";
import { buildCsv } from "../export";

/**
 * Tests unitarios del builder de CSV (FASE 13 — OWASP). El builder es
 * puro: no toca la DB, así que estos tests corren sin Supabase.
 */

describe("buildCsv", () => {
  it("agrega BOM UTF-8 para que Excel abra los acentos bien", () => {
    const { content } = buildCsv("packages", [["áéíóú", "ñ"]]);
    expect(content.startsWith("\uFEFF")).toBe(true);
  });

  it("escapa comillas y comas dentro de los valores", () => {
    const { content } = buildCsv("packages", [['val, con "comillas"', "normal"]]);
    const row = content.split("\n")[1];
    expect(row).toBe('"val, con ""comillas""",normal');
  });

  it("neutraliza inyección de fórmulas (valores que empiezan con = + - @)", () => {
    const { content } = buildCsv("packages", [
      ["=SUM(1,1)", "+123", "-cmd", "@xss", "normal"],
    ]);
    const lines = content.split("\n")[1];
    expect(lines).toContain("'=SUM(1,1)");
    expect(lines).toContain("'+123");
    expect(lines).toContain("'-cmd");
    expect(lines).toContain("'@xss");
    expect(lines).toContain(",normal");
  });

  it("deja vacíos los null/undefined", () => {
    const { content } = buildCsv("packages", [[null, undefined, "x"]]);
    const row = content.split("\n")[1];
    expect(row).toBe(",,x");
  });

  it("arma el nombre de archivo con el rango de fechas", () => {
    const from = new Date("2026-08-01T00:00:00Z");
    const to = new Date("2026-08-14T00:00:00Z");
    const { filename } = buildCsv("deliveries", [], from, to);
    expect(filename).toBe("entregas-2026-08-01_2026-08-14.csv");
  });
});
