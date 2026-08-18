/**
 * Utilidades geográficas — PROMPT-MAESTRO §8 (Agrupamiento y ruteo).
 *
 * Estrategia híbrida en 3 etapas (§8): acá viven las etapas 1 y 2, locales y
 * puras (nunca tocan la red ni la base):
 *
 *   1. `clusterPackages()`  — capacitated k-means++ + detección de outliers
 *      (DBSCAN-lite), con distancia haversine. Gratis, <1s para ~120 puntos.
 *   2. `sequenceRoute()`    — nearest neighbor + 2-opt DENTRO de un cluster
 *      ya formado. Recibe una función de distancia inyectada: en producción
 *      es la matriz de Google Routes API (cara, cacheada, ver
 *      `apps/web/src/lib/services/routing.ts`); en los tests o como
 *      fallback degradado, es haversine.
 *
 * La etapa 3 (ajuste humano: arrastrar, dividir, fusionar, aprobar) es UI +
 * servicio en `apps/web`, no pertenece a este package.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Accede a `arr[index]` sin `!` — falla ruidoso en vez de silencioso si el índice no existe. */
function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) {
    throw new Error(`índice ${index} fuera de rango (largo ${arr.length})`);
  }
  return value;
}

/** Distancia en línea recta entre dos puntos, en metros. Gratis, local. */
export function haversineDistanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// ─────────────────────────────────────────────────────────────────────────
// Etapa 1 — Clustering geográfico capacitado + outliers (§8)
// ─────────────────────────────────────────────────────────────────────────

export interface ClusterPoint extends LatLng {
  id: string;
}

export interface ClusterOptions {
  /**
   * Capacidad máxima de cada cluster, una entrada por chofer/vehículo
   * disponible — `k = capacities.length` (§8: "k = cantidad de choferes
   * disponibles", "restricción dura: ningún cluster supera la capacidad
   * del vehículo").
   */
  capacities: number[];
  /**
   * Distancia (metros) a partir de la cual un punto sin otro punto cerca
   * se marca como outlier (§8: "aislados a >5 km del cluster más
   * cercano"). Default 5000.
   */
  outlierDistanceM?: number;
  /** Máximo de iteraciones de Lloyd's capacitado. Default 25. */
  maxIterations?: number;
  /** Generador de aleatoriedad inyectable — determinismo en tests. Default `Math.random`. */
  randomFn?: () => number;
}

export interface ClusterBucket {
  centroid: LatLng | null;
  pointIds: string[];
}

export interface ClusterResult {
  /** Un elemento por cada capacidad pedida, en el mismo orden — puede quedar vacío. */
  clusters: ClusterBucket[];
  /** Puntos aislados (§8): no entran a ningún cluster, van a revisión manual. */
  outlierIds: string[];
}

function meanPoint(points: readonly LatLng[]): LatLng {
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
  return { lat, lng };
}

/**
 * DBSCAN-lite (§8): un punto es outlier si NINGÚN otro punto del conjunto
 * está a `outlierDistanceM` o menos. minPts=1 a propósito — con minPts>1 un
 * par de direcciones vecinas y solas quedaría marcado como outlier, y el
 * objetivo acá es solo detectar puntos verdaderamente aislados (§8: "un
 * solo paquete lejos puede costar 40 minutos").
 */
function detectOutliers(
  points: readonly ClusterPoint[],
  outlierDistanceM: number,
): Set<string> {
  const outliers = new Set<string>();
  // Con un solo punto no hay NADIE con quién compararlo — el loop de
  // abajo se saltea a sí mismo (`other.id === point.id`) y
  // `nearestNeighborM` queda en `Infinity`, que es SIEMPRE mayor que
  // `outlierDistanceM`: el único paquete de una ruta terminaba marcado
  // como outlier por construcción, no porque esté realmente lejos de
  // nada — bug real encontrado probando "agregar ruta" con 1 solo
  // paquete libre (nunca generaba ninguna ruta). Estar solo no es lo
  // mismo que estar lejos de los vecinos.
  if (points.length <= 1) return outliers;
  for (const point of points) {
    let nearestNeighborM = Infinity;
    for (const other of points) {
      if (other.id === point.id) continue;
      const d = haversineDistanceMeters(point, other);
      if (d < nearestNeighborM) nearestNeighborM = d;
    }
    if (nearestNeighborM > outlierDistanceM) outliers.add(point.id);
  }
  return outliers;
}

/** Inicialización k-means++ ponderada por distancia al cuadrado (estabilidad, §8). */
function initCentroids(
  points: readonly ClusterPoint[],
  k: number,
  randomFn: () => number,
): LatLng[] {
  const centroids: LatLng[] = [];

  const first = at(points, Math.floor(randomFn() * points.length));
  centroids.push({ lat: first.lat, lng: first.lng });

  while (centroids.length < k) {
    const weights = points.map((p) =>
      Math.min(...centroids.map((c) => haversineDistanceMeters(p, c) ** 2)),
    );
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight === 0) {
      // Todos los puntos restantes coinciden con un centroide existente —
      // no hay forma de diversificar más, se repite el primero.
      centroids.push({ ...at(centroids, 0) });
      continue;
    }
    let pick = randomFn() * totalWeight;
    let chosen = at(points, points.length - 1);
    for (let i = 0; i < points.length; i++) {
      pick -= at(weights, i);
      if (pick <= 0) {
        chosen = at(points, i);
        break;
      }
    }
    centroids.push({ lat: chosen.lat, lng: chosen.lng });
  }

  return centroids;
}

/**
 * Capacitated k-means (§8, etapa 1). No es k-means puro: la asignación
 * respeta la capacidad de cada cluster como restricción dura, procesando
 * los puntos del más "decidido" (más cerca de su mejor centroide) al más
 * disputado, y cayendo a la siguiente mejor opción cuando el cluster
 * preferido ya está lleno.
 */
export function clusterPackages(
  points: ClusterPoint[],
  options: ClusterOptions,
): ClusterResult {
  const k = options.capacities.length;
  if (k <= 0) {
    throw new Error("clusterPackages: se necesita al menos una capacidad (k >= 1)");
  }
  const outlierDistanceM = options.outlierDistanceM ?? 5_000;
  const maxIterations = options.maxIterations ?? 25;
  const randomFn = options.randomFn ?? Math.random;

  const emptyClusters: ClusterBucket[] = options.capacities.map(() => ({
    centroid: null,
    pointIds: [],
  }));

  if (points.length === 0) return { clusters: emptyClusters, outlierIds: [] };

  const outlierIdSet = detectOutliers(points, outlierDistanceM);
  const clusterable = points.filter((p) => !outlierIdSet.has(p.id));

  if (clusterable.length === 0) {
    return { clusters: emptyClusters, outlierIds: [...outlierIdSet] };
  }

  let centroids = initCentroids(clusterable, k, randomFn);
  let assignment = new Map<string, number>(); // pointId -> índice de cluster

  for (let iter = 0; iter < maxIterations; iter++) {
    // Orden de asignación: puntos más "decididos" primero (menor distancia
    // a su centroide más cercano) — reduce el efecto de orden arbitrario en
    // la calidad del resultado capacitado.
    const withBestDistance = clusterable
      .map((point) => {
        const distances = centroids.map((c) => haversineDistanceMeters(point, c));
        return { point, distances, best: Math.min(...distances) };
      })
      .sort((a, b) => a.best - b.best);

    const remainingCapacity = options.capacities.slice();
    const newAssignment = new Map<string, number>();

    for (const { point, distances } of withBestDistance) {
      const order = distances.map((d, idx) => ({ d, idx })).sort((a, b) => a.d - b.d);
      let target = at(order, 0).idx;
      for (const candidate of order) {
        if (at(remainingCapacity, candidate.idx) > 0) {
          target = candidate.idx;
          break;
        }
      }
      remainingCapacity[target] = at(remainingCapacity, target) - 1;
      newAssignment.set(point.id, target);
    }

    const converged =
      assignment.size === newAssignment.size &&
      [...newAssignment].every(([id, cluster]) => assignment.get(id) === cluster);
    assignment = newAssignment;

    if (converged) break;

    centroids = centroids.map((current, idx) => {
      const members = clusterable.filter((p) => assignment.get(p.id) === idx);
      return members.length > 0 ? meanPoint(members) : current;
    });
  }

  // Refinamiento de frontera (§8, paso 4): una pasada, mover un punto al
  // cluster vecino si queda más cerca de ese centroide y hay capacidad —
  // mejora la compacidad sin reabrir la convergencia completa.
  const remainingCapacity = options.capacities.map(
    (cap, idx) => cap - [...assignment.values()].filter((c) => c === idx).length,
  );
  for (const point of clusterable) {
    const currentIdx = assignment.get(point.id);
    if (currentIdx === undefined) continue;
    const currentDist = haversineDistanceMeters(point, at(centroids, currentIdx));
    let bestIdx = currentIdx;
    let bestDist = currentDist;
    for (let idx = 0; idx < centroids.length; idx++) {
      if (idx === currentIdx) continue;
      if (at(remainingCapacity, idx) <= 0) continue;
      const d = haversineDistanceMeters(point, at(centroids, idx));
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    }
    if (bestIdx !== currentIdx) {
      assignment.set(point.id, bestIdx);
      remainingCapacity[currentIdx] = at(remainingCapacity, currentIdx) + 1;
      remainingCapacity[bestIdx] = at(remainingCapacity, bestIdx) - 1;
    }
  }

  const clusters: ClusterBucket[] = options.capacities.map((_, idx) => {
    const memberIds = clusterable
      .filter((p) => assignment.get(p.id) === idx)
      .map((p) => p.id);
    const members = clusterable.filter((p) => memberIds.includes(p.id));
    return {
      centroid: members.length > 0 ? meanPoint(members) : null,
      pointIds: memberIds,
    };
  });

  return { clusters, outlierIds: [...outlierIdSet] };
}

// ─────────────────────────────────────────────────────────────────────────
// Etapa 2 — Secuenciación dentro de una ruta (§8)
// ─────────────────────────────────────────────────────────────────────────

export interface SequencePoint extends LatLng {
  id: string;
}

export interface SequenceOptions {
  /**
   * Función de distancia entre dos puntos, en metros. En producción es la
   * matriz real de Google Routes API (cacheada); acá por defecto es
   * haversine — un fallback degradado, nunca la fuente de verdad para
   * costeo real (§8: "nunca secuenciar con haversine" es la recomendación
   * de PRODUCCIÓN, no una prohibición de esta función pura, que no sabe de
   * dónde viene la distancia).
   */
  distanceFn?: (a: LatLng, b: LatLng) => number;
  /** Presupuesto de tiempo para el refinamiento 2-opt, en ms (§8: "5 s máximo"). */
  timeBudgetMs?: number;
}

export interface SequenceLeg {
  fromId: string;
  toId: string;
  distanceM: number;
}

export interface SequenceResult {
  orderedIds: string[];
  totalDistanceM: number;
  legs: SequenceLeg[];
}

function tourDistance(
  depot: LatLng,
  order: readonly SequencePoint[],
  distanceFn: (a: LatLng, b: LatLng) => number,
): number {
  let total = 0;
  let prev: LatLng = depot;
  for (const p of order) {
    total += distanceFn(prev, p);
    prev = p;
  }
  return total;
}

/** Distancia del tramo (i-1 → i) de un tour, tratando i=0 como saliendo del depósito. */
function edgeInto(
  depot: LatLng,
  order: readonly SequencePoint[],
  i: number,
  distanceFn: (a: LatLng, b: LatLng) => number,
): number {
  const from = i === 0 ? depot : at(order, i - 1);
  return distanceFn(from, at(order, i));
}

/** Distancia del tramo que sale de la posición j hacia j+1, o 0 si j es la última parada. */
function edgeOutOf(
  order: readonly SequencePoint[],
  j: number,
  distanceFn: (a: LatLng, b: LatLng) => number,
): number {
  if (j + 1 >= order.length) return 0;
  return distanceFn(at(order, j), at(order, j + 1));
}

/**
 * Nearest neighbor desde el depósito + mejora 2-opt (§8, etapa 2). No
 * conoce direcciones prohibidas ni sentido único — eso lo resuelve la
 * matriz de distancias reales que se le inyecta vía `distanceFn` cuando
 * viene de Google Routes API.
 */
export function sequenceRoute(
  depot: LatLng,
  points: SequencePoint[],
  options: SequenceOptions = {},
): SequenceResult {
  const distanceFn = options.distanceFn ?? haversineDistanceMeters;
  const timeBudgetMs = options.timeBudgetMs ?? 5_000;

  if (points.length === 0) return { orderedIds: [], totalDistanceM: 0, legs: [] };

  // Nearest neighbor.
  const unvisited = [...points];
  const order: SequencePoint[] = [];
  let current: LatLng = depot;
  while (unvisited.length > 0) {
    let bestIdx = 0;
    let bestDist = distanceFn(current, at(unvisited, 0));
    for (let i = 1; i < unvisited.length; i++) {
      const d = distanceFn(current, at(unvisited, i));
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = at(unvisited, bestIdx);
    unvisited.splice(bestIdx, 1);
    order.push(next);
    current = next;
  }

  // 2-opt: invertir segmentos [i, j] mientras reduzcan la distancia total,
  // acotado por presupuesto de tiempo.
  const deadline = Date.now() + timeBudgetMs;
  let improved = true;
  while (improved && Date.now() < deadline) {
    improved = false;
    for (let i = 0; i < order.length - 1 && Date.now() < deadline; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const before =
          edgeInto(depot, order, i, distanceFn) + edgeOutOf(order, j, distanceFn);
        const reversed = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ];
        const after =
          edgeInto(depot, reversed, i, distanceFn) + edgeOutOf(reversed, j, distanceFn);
        if (after + 1e-6 < before) {
          order.splice(0, order.length, ...reversed);
          improved = true;
        }
      }
    }
  }

  const legs: SequenceLeg[] = [];
  let prev: LatLng = depot;
  let prevId = "DEPOT";
  for (const p of order) {
    legs.push({ fromId: prevId, toId: p.id, distanceM: distanceFn(prev, p) });
    prev = p;
    prevId = p.id;
  }

  return {
    orderedIds: order.map((p) => p.id),
    totalDistanceM: tourDistance(depot, order, distanceFn),
    legs,
  };
}
