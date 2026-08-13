import * as React from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { colors } from "../theme/tokens";

/**
 * Mapa de "Mis paradas" — pedido explícito de Fede: la pantalla principal
 * de la app tiene que verse como un mapa con las paradas pineadas y
 * numeradas (igual al patrón de apps de reparto conocidas), no una lista
 * pelada. Colores/tema siguen siendo los de FYC (oscuro, §13) — se
 * confirmó explícitamente no copiar la paleta de la app de referencia.
 *
 * Implementado con Leaflet adentro de un WebView, NO `react-native-maps`:
 * `react-native-maps` en Android requiere una API key de Google Maps para
 * las tiles (mismo tipo de fricción que ya resolvimos para geocoding) y
 * es otro pipeline de configuración de billing aparte. Leaflet + tiles
 * gratuitas de CartoCDN (mismo proveedor que ya usa el mapa de ruteo del
 * panel web, ver ADR-043) no necesita ninguna key — se genera 100% local
 * en el HTML del WebView, sin pedirle nada al servidor.
 */

export interface RouteMapStop {
  id: string;
  sequence: number;
  lat: number;
  lng: number;
  status: string;
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

function buildHtml(stops: RouteMapStop[]): string {
  const points = stops
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ ...s, color: statusColor(s.status) }));

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { height: 100%; margin: 0; background: ${colors.bg}; }
  .stop-pin {
    width: 28px; height: 28px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font: 700 12px system-ui, sans-serif; color: #0F1115;
    border: 2px solid ${colors.bg};
    box-shadow: 0 1px 3px rgba(0,0,0,.5);
  }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const points = ${JSON.stringify(points)};
  const map = L.map('map', { zoomControl: false, attributionControl: false });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd', maxZoom: 20,
  }).addTo(map);

  if (points.length > 0) {
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  } else {
    map.setView([-34.6, -58.45], 11);
  }

  for (const p of points) {
    const icon = L.divIcon({
      className: '',
      html: '<div class="stop-pin" style="background:' + p.color + '">' + p.sequence + '</div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
    marker.on('click', () => {
      window.ReactNativeWebView.postMessage(p.id);
    });
  }
</script>
</body>
</html>`;
}

export function RouteMapView({
  stops,
  onStopPress,
  height = 260,
}: {
  stops: RouteMapStop[];
  onStopPress?: (stopId: string) => void;
  height?: number;
}) {
  // Se recalcula solo cuando cambia la lista de paradas (no en cada
  // render) — reconstruir el HTML entero recarga el WebView, no vale la
  // pena hacerlo por cambios que no tocan pines (ej. un timer de arriba).
  const html = React.useMemo(() => buildHtml(stops), [stops]);

  return (
    <View style={{ height, borderRadius: 12, overflow: "hidden" }}>
      <WebView
        originWhitelist={["*"]}
        source={{ html }}
        onMessage={(e) => onStopPress?.(e.nativeEvent.data)}
        style={{ backgroundColor: colors.bg }}
      />
    </View>
  );
}
