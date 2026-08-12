import { describe, expect, it } from "vitest";
import { getBackoffDelayMs, getNextAttemptAt } from "./backoff";

describe("getBackoffDelayMs", () => {
  it("sigue el schedule de §12: 5s, 15s, 1m, 5m, 15m, 1h", () => {
    expect(getBackoffDelayMs(0)).toBe(5_000);
    expect(getBackoffDelayMs(1)).toBe(15_000);
    expect(getBackoffDelayMs(2)).toBe(60_000);
    expect(getBackoffDelayMs(3)).toBe(5 * 60_000);
    expect(getBackoffDelayMs(4)).toBe(15 * 60_000);
    expect(getBackoffDelayMs(5)).toBe(60 * 60_000);
  });

  it("se queda en el último escalón (1h) para cualquier cantidad de intentos mayor", () => {
    expect(getBackoffDelayMs(6)).toBe(60 * 60_000);
    expect(getBackoffDelayMs(100)).toBe(60 * 60_000);
  });

  it("nunca da un delay negativo con un valor negativo raro de attempts", () => {
    expect(getBackoffDelayMs(-1)).toBe(5_000);
  });
});

describe("getNextAttemptAt", () => {
  it("suma el delay del backoff a la hora dada", () => {
    const now = new Date("2026-08-12T10:00:00.000Z");
    const next = getNextAttemptAt(0, now);
    expect(next).toBe("2026-08-12T10:00:05.000Z");
  });
});
