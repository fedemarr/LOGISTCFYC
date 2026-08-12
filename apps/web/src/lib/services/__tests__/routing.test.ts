/**
 * `getDistanceMatrix` — cascada de caché (§8, etapa 2). Sin
 * `GOOGLE_ROUTES_API_KEY` configurada (caso real de este repo, ver `.env`),
 * cae siempre al fallback estimado — se verifica ese camino y el de caché
 * ya poblada a mano (simulando una corrida anterior con la API real).
 */
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { routeMatrixCache } from "@/lib/db/schema";
import { getDistanceMatrix, matrixLookup } from "../routing";

describe("getDistanceMatrix (integración contra Supabase real)", () => {
  const villaBallester = { lat: -34.5489, lng: -58.5645 };
  const sanMartin = { lat: -34.5755, lng: -58.5326 };
  const insertedHashes: string[] = [];

  afterAll(async () => {
    if (insertedHashes.length === 0) return;
    for (const hash of insertedHashes) {
      await db.delete(routeMatrixCache).where(eq(routeMatrixCache.pairHash, hash));
    }
  });

  it("sin API key configurada, degrada a una estimación (nunca tira excepción)", async () => {
    expect(process.env.GOOGLE_ROUTES_API_KEY ?? "").toBe("");

    const matrix = await getDistanceMatrix([villaBallester], [sanMartin]);
    expect(matrix).toHaveLength(1);
    const leg = matrix[0]?.[0];
    expect(leg?.estimated).toBe(true);
    expect(leg?.distanceM).toBeGreaterThan(0);
    expect(leg?.durationS).toBeGreaterThan(0);
  });

  it("usa route_matrix_cache si el par ya está cacheado (corrida anterior con API real)", async () => {
    // Coordenadas propias de este test para no chocar con otras corridas en paralelo.
    const origin = { lat: -34.6, lng: -58.4 };
    const dest = { lat: -34.61, lng: -58.41 };

    const { createHash } = await import("node:crypto");
    const round = (n: number) => Math.round(n * 1e5) / 1e5;
    const hash = createHash("sha256")
      .update(
        `${round(origin.lat)},${round(origin.lng)}|${round(dest.lat)},${round(dest.lng)}`,
      )
      .digest("hex");
    insertedHashes.push(hash);

    await db.insert(routeMatrixCache).values({
      pairHash: hash,
      originLat: origin.lat,
      originLng: origin.lng,
      destLat: dest.lat,
      destLng: dest.lng,
      distanceM: 1234,
      durationS: 300,
      provider: "google",
    });

    const matrix = await getDistanceMatrix([origin], [dest]);
    const leg = matrix[0]?.[0];
    expect(leg?.estimated).toBe(false);
    expect(leg?.distanceM).toBe(1234);
    expect(leg?.durationS).toBe(300);
  });

  it("matriz vacía si no hay orígenes o destinos", async () => {
    expect(await getDistanceMatrix([], [villaBallester])).toEqual([]);
    expect(await getDistanceMatrix([villaBallester], [])).toEqual([]);
  });
});

describe("matrixLookup", () => {
  it("cae a una estimación cuando el punto no está en la matriz resuelta", () => {
    const points = [{ lat: 1, lng: 1 }];
    const lookup = matrixLookup(points, [
      [{ distanceM: 10, durationS: 1, estimated: false }],
    ]);
    const result = lookup({ lat: 99, lng: 99 }, { lat: 1, lng: 1 });
    expect(result.estimated).toBe(true);
  });

  it("devuelve el valor exacto de la matriz cuando el punto coincide", () => {
    const points = [
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ];
    const matrix = [
      [
        { distanceM: 0, durationS: 0, estimated: false },
        { distanceM: 500, durationS: 60, estimated: false },
      ],
      [
        { distanceM: 500, durationS: 60, estimated: false },
        { distanceM: 0, durationS: 0, estimated: false },
      ],
    ];
    const lookup = matrixLookup(points, matrix);
    expect(lookup(points[0]!, points[1]!)).toEqual({
      distanceM: 500,
      durationS: 60,
      estimated: false,
    });
  });
});
