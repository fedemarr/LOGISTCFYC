import { describe, expect, it } from "vitest";
import {
  clusterPackages,
  haversineDistanceMeters,
  sequenceRoute,
  type ClusterPoint,
  type LatLng,
} from "../index.js";

describe("haversineDistanceMeters", () => {
  it("da 0 para el mismo punto", () => {
    const p = { lat: -34.6037, lng: -58.3816 };
    expect(haversineDistanceMeters(p, p)).toBe(0);
  });

  it("aproxima la distancia Obelisco → La Tablada (~15-16 km)", () => {
    const obelisco = { lat: -34.6037, lng: -58.3816 };
    const laTablada = { lat: -34.6837, lng: -58.5619 };
    const d = haversineDistanceMeters(obelisco, laTablada);
    expect(d).toBeGreaterThan(14_000);
    expect(d).toBeLessThan(20_000);
  });
});

/** Genera una nube de puntos apretada alrededor de un centro (para simular un barrio). */
function cloud(
  idPrefix: string,
  center: LatLng,
  n: number,
  spreadDeg: number,
): ClusterPoint[] {
  const points: ClusterPoint[] = [];
  for (let i = 0; i < n; i++) {
    // Determinístico (no Math.random) para que los tests no sean flaky.
    const angle = (i / n) * 2 * Math.PI;
    const r = (spreadDeg * ((i % 3) + 1)) / 3;
    points.push({
      id: `${idPrefix}-${i}`,
      lat: center.lat + r * Math.cos(angle),
      lng: center.lng + r * Math.sin(angle),
    });
  }
  return points;
}

// Generador seudo-aleatorio determinístico para inyectar en `randomFn`.
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

describe("clusterPackages", () => {
  const villaBallester = { lat: -34.5489, lng: -58.5645 };
  const sanMartin = { lat: -34.5755, lng: -58.5326 };

  it("con 0 puntos devuelve k clusters vacíos y ningún outlier", () => {
    const result = clusterPackages([], { capacities: [10, 10] });
    expect(result.clusters).toHaveLength(2);
    expect(
      result.clusters.every((c) => c.pointIds.length === 0 && c.centroid === null),
    ).toBe(true);
    expect(result.outlierIds).toHaveLength(0);
  });

  it("tira un error si no se pasa ninguna capacidad (k=0)", () => {
    expect(() =>
      clusterPackages([{ id: "a", lat: 0, lng: 0 }], { capacities: [] }),
    ).toThrow(/k >= 1/);
  });

  it("agrupa dos barrios separados en dos clusters distintos, cada uno compacto", () => {
    const points = [
      ...cloud("VB", villaBallester, 20, 0.01),
      ...cloud("SM", sanMartin, 20, 0.01),
    ];
    const result = clusterPackages(points, {
      capacities: [25, 25],
      randomFn: seededRandom(42),
    });

    expect(result.outlierIds).toHaveLength(0);
    const totalAssigned = result.clusters.reduce((sum, c) => sum + c.pointIds.length, 0);
    expect(totalAssigned).toBe(40);

    // Cada barrio debería terminar mayormente en un único cluster (no mezclado 50/50).
    for (const prefix of ["VB", "SM"]) {
      const counts = result.clusters.map(
        (c) => c.pointIds.filter((id) => id.startsWith(prefix)).length,
      );
      const max = Math.max(...counts);
      expect(max).toBeGreaterThanOrEqual(18); // al menos 90% del barrio junto
    }
  });

  it("respeta la capacidad como restricción dura, incluso forzando un cluster chico", () => {
    const points = cloud("VB", villaBallester, 30, 0.01);
    const result = clusterPackages(points, {
      capacities: [5, 25],
      randomFn: seededRandom(7),
    });

    const [small, big] = result.clusters;
    expect(small?.pointIds.length).toBeLessThanOrEqual(5);
    expect(big?.pointIds.length).toBeLessThanOrEqual(25);
    const totalAssigned = result.clusters.reduce((sum, c) => sum + c.pointIds.length, 0);
    expect(totalAssigned).toBe(30);
  });

  it("marca como outlier un punto aislado a más de 5 km de todo lo demás", () => {
    const points = [
      ...cloud("VB", villaBallester, 10, 0.005),
      { id: "LEJOS", lat: -34.9, lng: -58.9 }, // La Plata, bien lejos del cluster
    ];
    const result = clusterPackages(points, {
      capacities: [15],
      randomFn: seededRandom(1),
    });

    expect(result.outlierIds).toEqual(["LEJOS"]);
    const [only] = result.clusters;
    expect(only?.pointIds).not.toContain("LEJOS");
    expect(only?.pointIds).toHaveLength(10);
  });

  it("un solo punto (sin nadie con quién compararse) NO es outlier — regresión bug real", () => {
    // Encontrado probando "agregar ruta" con 1 solo paquete libre: sin
    // otro punto para comparar, `nearestNeighborM` quedaba en `Infinity`
    // (siempre mayor al umbral) y el único paquete de la ruta se
    // marcaba como outlier por construcción — ninguna ruta se generaba
    // nunca para un caso de 1 solo paquete, aunque sea perfectamente
    // válido rutear un único bulto.
    const result = clusterPackages([{ id: "solo", ...villaBallester }], {
      capacities: [10],
    });
    expect(result.outlierIds).toHaveLength(0);
    expect(result.clusters[0]?.pointIds).toEqual(["solo"]);
  });

  it("un umbral de outlier más chico deja pasar puntos que antes eran outliers", () => {
    const points = cloud("VB", villaBallester, 10, 0.02); // dispersión más amplia
    const strict = clusterPackages(points, {
      capacities: [15],
      outlierDistanceM: 100, // casi cualquier separación cuenta como outlier
      randomFn: seededRandom(3),
    });
    expect(strict.outlierIds.length).toBeGreaterThan(0);
  });
});

describe("sequenceRoute", () => {
  const depot = { lat: -34.55, lng: -58.5 };

  it("con 0 puntos devuelve secuencia vacía", () => {
    const result = sequenceRoute(depot, []);
    expect(result.orderedIds).toEqual([]);
    expect(result.totalDistanceM).toBe(0);
  });

  it("devuelve una permutación exacta de los ids de entrada", () => {
    const points = cloud("P", depot, 12, 0.02);
    const result = sequenceRoute(depot, points, { timeBudgetMs: 200 });
    expect(result.orderedIds.slice().sort()).toEqual(points.map((p) => p.id).sort());
    expect(result.legs).toHaveLength(points.length);
  });

  it("2-opt nunca empeora lo que ya encontró nearest neighbor", () => {
    // Puntos en zigzag: nearest neighbor puro puede quedar sub-óptimo, 2-opt lo mejora o iguala.
    const points = [
      { id: "a", lat: depot.lat + 0.01, lng: depot.lng },
      { id: "b", lat: depot.lat, lng: depot.lng + 0.02 },
      { id: "c", lat: depot.lat + 0.01, lng: depot.lng + 0.04 },
      { id: "d", lat: depot.lat, lng: depot.lng + 0.06 },
    ];
    const withTwoOpt = sequenceRoute(depot, points, { timeBudgetMs: 500 });
    const withoutTwoOpt = sequenceRoute(depot, points, { timeBudgetMs: 0 });
    expect(withTwoOpt.totalDistanceM).toBeLessThanOrEqual(
      withoutTwoOpt.totalDistanceM + 1e-6,
    );
  });

  it("usa la distanceFn inyectada en vez de haversine si se provee", () => {
    const points = [
      { id: "a", lat: 1, lng: 1 },
      { id: "b", lat: 2, lng: 2 },
    ];
    let calls = 0;
    const result = sequenceRoute(depot, points, {
      distanceFn: (a, b) => {
        calls++;
        return haversineDistanceMeters(a, b) * 2; // "matriz real" ficticia, más cara
      },
    });
    expect(calls).toBeGreaterThan(0);
    expect(result.totalDistanceM).toBeGreaterThan(0);
  });
});
