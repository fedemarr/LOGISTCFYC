/**
 * Geocoding con caché agresivo — PROMPT-MAESTRO §5/§8: "Caché agresivo en
 * tabla propia. Nunca geocodificar dos veces la misma dirección
 * normalizada". Cascada de resolución de coordenadas (de más a menos
 * barata):
 *
 *   1. `known_addresses`  — esta dirección exacta ya se geocodificó y
 *      quedó en el catálogo (memoria de direcciones, §2). Costo: cero.
 *   2. `geocode_cache`    — la respuesta cruda del proveedor para esta
 *      dirección normalizada ya está cacheada (aunque no haya
 *      `known_addresses` todavía, ej. vino de otra org). Costo: cero.
 *   3. Google Geocoding API — última opción, la única que cuesta plata.
 *
 * Si `GOOGLE_GEOCODING_API_KEY` no está configurada, degrada con
 * `accuracy: "FAILED"` en vez de tirar una excepción (§16: "Geocoding
 * falla → Marca FAILED, va a revisión manual. No entra al ruteo").
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Role } from "@fyc/shared";
import { hashNormalizedAddress } from "@fyc/shared";
import { db } from "@/lib/db";
import { geocodeCache, knownAddresses, packages } from "@/lib/db/schema";
import { runPackageTransition } from "./state-machine";

export interface GeocodeResult {
  lat: number | null;
  lng: number | null;
  accuracy: "ROOFTOP" | "INTERPOLATED" | "APPROXIMATE" | "MANUAL" | "FAILED";
  source: "known_address" | "cache" | "google" | "not_configured";
}

interface GoogleGeocodeResponse {
  status: string;
  results: Array<{
    geometry: {
      location: { lat: number; lng: number };
      location_type:
        "ROOFTOP" | "RANGE_INTERPOLATED" | "GEOMETRIC_CENTER" | "APPROXIMATE";
    };
  }>;
}

function mapGoogleAccuracy(
  locationType: GoogleGeocodeResponse["results"][number]["geometry"]["location_type"],
): GeocodeResult["accuracy"] {
  switch (locationType) {
    case "ROOFTOP":
      return "ROOFTOP";
    case "RANGE_INTERPOLATED":
      return "INTERPOLATED";
    default:
      return "APPROXIMATE";
  }
}

/**
 * Llama a la API real de Google. Aislado en su propia función para poder
 * mockear `fetch` en los tests sin tocar la lógica de caché.
 */
async function callGoogleGeocoding(
  rawText: string,
  apiKey: string,
): Promise<GeocodeResult | null> {
  const bbox = process.env.OPERATIONAL_BBOX; // "minLat,minLng,maxLat,maxLng" — opcional
  const params = new URLSearchParams({
    address: `${rawText}, Buenos Aires, Argentina`,
    key: apiKey,
    region: "ar",
  });
  if (bbox) {
    const [minLat, minLng, maxLat, maxLng] = bbox.split(",");
    if (minLat && minLng && maxLat && maxLng) {
      params.set("bounds", `${minLat},${minLng}|${maxLat},${maxLng}`);
    }
  }

  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
  );
  if (!response.ok) return null;

  const body = (await response.json()) as GoogleGeocodeResponse;
  if (body.status !== "OK" || body.results.length === 0) return null;

  const [first] = body.results;
  if (!first) return null;
  return {
    lat: first.geometry.location.lat,
    lng: first.geometry.location.lng,
    accuracy: mapGoogleAccuracy(first.geometry.location_type),
    source: "google",
  };
}

/** Geocodifica una dirección, pasando por la cascada de caché completa. */
export async function geocodeAddress(rawText: string): Promise<GeocodeResult> {
  const hash = await hashNormalizedAddress(rawText);

  const [known] = await db
    .select({
      lat: knownAddresses.lat,
      lng: knownAddresses.lng,
      accuracy: knownAddresses.geocodeAccuracy,
    })
    .from(knownAddresses)
    .where(eq(knownAddresses.normalizedHash, hash));
  if (known?.lat != null && known.lng != null) {
    return {
      lat: known.lat,
      lng: known.lng,
      accuracy: known.accuracy,
      source: "known_address",
    };
  }

  const [cached] = await db
    .select({
      lat: geocodeCache.lat,
      lng: geocodeCache.lng,
      accuracy: geocodeCache.accuracy,
    })
    .from(geocodeCache)
    .where(eq(geocodeCache.queryHash, hash));
  if (cached?.lat != null && cached.lng != null && cached.accuracy) {
    return {
      lat: cached.lat,
      lng: cached.lng,
      accuracy: cached.accuracy,
      source: "cache",
    };
  }

  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!apiKey) {
    return { lat: null, lng: null, accuracy: "FAILED", source: "not_configured" };
  }

  const googleResult = await callGoogleGeocoding(rawText, apiKey);
  const result: GeocodeResult = googleResult ?? {
    lat: null,
    lng: null,
    accuracy: "FAILED",
    source: "google",
  };

  // Cachear SIEMPRE, incluso los fallos — evita re-pagar por una dirección
  // que Google no puede resolver (§5: "nunca geocodificar dos veces").
  await db
    .insert(geocodeCache)
    .values({
      queryHash: hash,
      provider: "google",
      rawResponse: { lat: result.lat, lng: result.lng, accuracy: result.accuracy },
      lat: result.lat,
      lng: result.lng,
      accuracy: result.accuracy,
    })
    .onConflictDoNothing({ target: geocodeCache.queryHash });

  return result;
}

/** Encuentra o crea la fila de `known_addresses` para esta dirección resuelta. */
async function upsertKnownAddress(params: {
  orgId: string;
  rawText: string;
  hash: string;
  result: GeocodeResult;
}): Promise<string | null> {
  if (params.result.lat == null || params.result.lng == null) return null;

  const [existing] = await db
    .select({ id: knownAddresses.id })
    .from(knownAddresses)
    .where(eq(knownAddresses.normalizedHash, params.hash));
  if (existing) return existing.id;

  const [created] = await db
    .insert(knownAddresses)
    .values({
      orgId: params.orgId,
      normalizedHash: params.hash,
      rawText: params.rawText,
      lat: params.result.lat,
      lng: params.result.lng,
      geocodeSource: params.result.source,
      geocodeAccuracy: params.result.accuracy,
    })
    .onConflictDoNothing({ target: knownAddresses.normalizedHash })
    .returning({ id: knownAddresses.id });

  if (created) return created.id;
  // Carrera: otro proceso lo creó entre el select y el insert — releer.
  const [reread] = await db
    .select({ id: knownAddresses.id })
    .from(knownAddresses)
    .where(eq(knownAddresses.normalizedHash, params.hash));
  return reread?.id ?? null;
}

export interface OperationGeocodeSummary {
  processed: number;
  geocoded: number;
  failed: number;
}

/**
 * Geocodifica en lote los paquetes RECIBIDO de una operación (§9.1, paso
 * 5: "Geocodificar en lote, job en background"). Cada paquete resuelto
 * pasa a GEOCODIFICADO; los que fallan quedan en RECIBIDO con
 * `known_addresses`/cache marcando el intento como FAILED — no entran al
 * ruteo de FASE 6 hasta que alguien los corrija a mano (§16).
 */
export async function geocodeOperationPackages(
  orgId: string,
  operationId: string,
  actor: { userId: string; roles: readonly Role[] },
): Promise<OperationGeocodeSummary> {
  const pending = await db
    .select({ id: packages.id, rawAddressText: packages.rawAddressText })
    .from(packages)
    .where(
      and(
        eq(packages.orgId, orgId),
        eq(packages.operationId, operationId),
        eq(packages.status, "RECIBIDO"),
        isNull(packages.deletedAt),
      ),
    );

  const summary: OperationGeocodeSummary = { processed: 0, geocoded: 0, failed: 0 };

  for (const pkg of pending) {
    summary.processed++;
    if (!pkg.rawAddressText) {
      summary.failed++;
      continue;
    }

    const result = await geocodeAddress(pkg.rawAddressText);
    if (result.lat == null || result.lng == null) {
      summary.failed++;
      continue;
    }

    const hash = await hashNormalizedAddress(pkg.rawAddressText);
    const addressId = await upsertKnownAddress({
      orgId,
      rawText: pkg.rawAddressText,
      hash,
      result,
    });

    await db
      .update(packages)
      .set({ addressId, updatedAt: new Date() })
      .where(eq(packages.id, pkg.id));

    await runPackageTransition({
      packageId: pkg.id,
      toStatus: "GEOCODIFICADO",
      actorId: actor.userId,
      actorRoles: actor.roles,
      metadata: { geocodeSource: result.source, accuracy: result.accuracy },
    });

    summary.geocoded++;
  }

  return summary;
}
