import * as React from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { colors } from "../theme/tokens";

/**
 * Mapa de "Mis paradas" — Google Maps real (pedido explícito de Fede,
 * después de probar la primera versión con Leaflet+WebView y pedir "un
 * mapa mejor, como el de Google"). Requiere `GOOGLE_MAPS_API_KEY_ANDROID`
 * en el build (ver `app.config.ts` / `eas.json`) — key restringida a
 * "Maps SDK for Android" + el paquete/SHA-1 de la app, misma lógica que
 * las keys server-side de geocoding/routes (ver docs/DECISIONES.md).
 *
 * Reemplaza el mapa anterior (Leaflet adentro de un WebView, sin key,
 * ver ADR de FASE A) — ese seguía siendo válido como fallback sin
 * facturación, pero Fede prefirió pagar el mapa real. El punto azul de
 * ubicación ahora lo resuelve `react-native-maps` nativo
 * (`showsUserLocation`), no hace falta manejarlo a mano como con Leaflet.
 */

export interface RouteMapStop {
  id: string;
  sequence: number;
  lat: number;
  lng: number;
  status: string;
}

export interface RouteMapUserLocation {
  lat: number;
  lng: number;
}

function statusColor(status: string): string {
  switch (status) {
    case "COMPLETED":
      return colors.success;
    case "FAILED":
      return colors.danger;
    case "ARRIVED":
      return colors.active;
    default:
      return colors.pending;
  }
}

export function RouteMapView({
  stops,
  onStopPress,
  height = 260,
  userLocation = null,
}: {
  stops: RouteMapStop[];
  onStopPress?: (stopId: string) => void;
  height?: number;
  /** Ya no hace falta pasarla — `showsUserLocation` la resuelve sola —
   *  se mantiene el prop para no romper a quien todavía la pasa. */
  userLocation?: RouteMapUserLocation | null;
}) {
  const mapRef = React.useRef<MapView>(null);
  const points = React.useMemo(
    () => stops.filter((s) => s.lat != null && s.lng != null),
    [stops],
  );

  // Encuadra todas las paradas (+ ubicación del chofer, si ya la tiene)
  // apenas hay puntos para mostrar — mismo criterio que tenía el mapa de
  // Leaflet (fitBounds), react-native-maps lo llama fitToCoordinates.
  React.useEffect(() => {
    if (points.length === 0 || !mapRef.current) return;
    const coords = points.map((p) => ({ latitude: p.lat, longitude: p.lng }));
    if (userLocation)
      coords.push({ latitude: userLocation.lat, longitude: userLocation.lng });
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
      animated: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo re-encuadrar cuando cambia la cantidad de puntos, no en cada pequeño ajuste
  }, [points.length]);

  return (
    <View style={{ height, borderRadius: 12, overflow: "hidden" }}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        showsUserLocation
        showsMyLocationButton
        initialRegion={{
          latitude: points[0]?.lat ?? -34.6,
          longitude: points[0]?.lng ?? -58.45,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        }}
      >
        {points.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            onPress={() => onStopPress?.(p.id)}
          >
            <View style={[styles.pin, { backgroundColor: statusColor(p.status) }]}>
              <Text style={styles.pinLabel}>{p.sequence}</Text>
            </View>
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  pin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.bg,
  },
  pinLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F1115",
  },
});
