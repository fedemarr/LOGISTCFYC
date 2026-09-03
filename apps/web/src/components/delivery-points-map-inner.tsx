"use client";

import * as React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface DeliveryPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  delivered: boolean;
}

const DEFAULT_CENTER: L.LatLngExpression = [-34.6, -58.45];
const DEFAULT_ZOOM = 12;

function makeIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.5)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

const PENDING_ICON = makeIcon("#3b82f6");
const DELIVERED_ICON = makeIcon("#22c55e");

/** Mapa de puntos de entrega (pedido de Fede: apartado de mapa en la PWA
 * del chofer) — mismo patrón que `leaflet-map.tsx` del panel (Leaflet
 * directo, cargado dinámicamente con ssr:false porque necesita `window`). */
export default function DeliveryPointsMapInner({ points }: { points: DeliveryPoint[] }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const layerRef = React.useRef<L.LayerGroup | null>(null);

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const bounds: L.LatLngExpression[] = [];

    for (const point of points) {
      L.marker([point.lat, point.lng], {
        icon: point.delivered ? DELIVERED_ICON : PENDING_ICON,
      })
        .addTo(layer)
        .bindPopup(`<strong>${point.label}</strong>`);
      bounds.push([point.lat, point.lng]);
    }

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 15 });
    }
  }, [points]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      aria-label="Mapa de puntos de entrega"
    />
  );
}
