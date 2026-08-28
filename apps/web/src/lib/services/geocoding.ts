import { Errors } from "@/lib/api/errors";

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

interface GoogleGeocodeResponse {
  status: string;
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
}

/**
 * Geocodifica texto libre (ej. "Moreno, Buenos Aires") a coordenadas —
 * pedido de Fede: el chofer escribe su zona de reparto al arrancar el
 * turno en vez de elegir de una lista fija armada de antemano por el
 * admin (`startShift` en `services/shifts.ts` la usa para crear/reusar
 * la zona). Sesga resultados a Argentina (`region=ar`) sin forzar ninguna
 * bounding box — el texto ya suele venir con la localidad.
 */
export async function geocodeText(rawText: string): Promise<GeocodeResult> {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!apiKey) {
    throw Errors.internal("geocoding no configurado (falta GOOGLE_GEOCODING_API_KEY)");
  }

  const params = new URLSearchParams({ address: rawText, key: apiKey, region: "ar" });
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
  );
  if (!response.ok) {
    throw Errors.internal("el servicio de geocoding no respondió");
  }

  const body = (await response.json()) as GoogleGeocodeResponse;
  const [first] = body.results;
  if (body.status !== "OK" || !first) {
    throw Errors.validation(
      `no se pudo ubicar "${rawText}" — probá ser más específico (ej. "Moreno, Buenos Aires")`,
    );
  }

  return {
    lat: first.geometry.location.lat,
    lng: first.geometry.location.lng,
    formattedAddress: first.formatted_address,
  };
}
