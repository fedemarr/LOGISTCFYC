/**
 * Test de rate limiting contra la base REAL de Supabase (mismo patrón que
 * `rls.test.ts`): el UPSERT atómico de `consumeRateLimit` debe dejar pasar
 * `limit` requests y rechazar la siguiente con AppError RATE_LIMITED.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { AppError, Errors } from "../errors";
import { consumeRateLimit } from "../rate-limit";
import { db } from "@/lib/db";

describe("rate limiting (integración contra Supabase real)", () => {
  const runId = randomUUID().slice(0, 8);
  const key = `test-${runId}`;

  afterAll(async () => {
    await db.execute(sql`delete from rate_limits where key = ${key}`);
  });

  it("deja pasar `limit` requests y rechaza la siguiente", async () => {
    for (let i = 0; i < 3; i++) {
      await expect(
        consumeRateLimit(key, { limit: 3, windowSeconds: 60 }),
      ).resolves.toBeUndefined();
    }

    const err = await consumeRateLimit(key, { limit: 3, windowSeconds: 60 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("RATE_LIMITED");
    expect((err as AppError).httpStatus).toBe(429);
  });

  it("una ventana nueva (otra key) empieza de cero", async () => {
    const freshKey = `${key}-fresh`;
    try {
      await expect(
        consumeRateLimit(freshKey, { limit: 1, windowSeconds: 60 }),
      ).resolves.toBeUndefined();
      const err = await consumeRateLimit(freshKey, { limit: 1, windowSeconds: 60 }).catch(
        (e: unknown) => e,
      );
      expect((err as AppError).code).toBe("RATE_LIMITED");
    } finally {
      await db.execute(sql`delete from rate_limits where key = ${freshKey}`);
    }
  });

  it("Erros.rateLimited tiene la forma estándar", () => {
    const err = Errors.rateLimited();
    expect(err.httpStatus).toBe(429);
    expect(err.message).toMatch(/minuto/i);
  });
});
