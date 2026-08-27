"use client";

import * as React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapZone, MapDriver } from "./fleet-map";

const DEFAULT_CENTER: L.LatLngExpression = [-34.9, -64.97];
const DEFAULT_ZOOM = 6;

function makeIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.5)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

const INSIDE_ICON = makeIcon("#22c55e");
const OUTSIDE_ICON = makeIcon("#ef4444");

export default function LeafletMap({
  zones,
  drivers,
}: {
  zones: MapZone[];
  drivers: MapDriver[];
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const layerRef = React.useRef<L.LayerGroup | null>(null);

  // Inicializa el mapa una sola vez.
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

  // Redibuja la capa (zonas + choferes) en cada actualización del feed.
  React.useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    for (const zone of zones) {
      L.circle([zone.centerLat, zone.centerLng], {
        radius: zone.radiusM,
        color: zone.colorHex,
        weight: 2,
        fillOpacity: 0.08,
      })
        .bindPopup(`<strong>${zone.name}</strong><br/>radio: ${zone.radiusM} m`)
        .addTo(layer);
    }

    for (const driver of drivers) {
      L.marker([driver.lat, driver.lng], {
        icon: driver.outside ? OUTSIDE_ICON : INSIDE_ICON,
      })
        .addTo(layer)
        .bindPopup(
          `<strong>${driver.fullName}</strong><br/>${
            driver.outside ? "afuera de la zona" : "dentro de la zona"
          }`,
        );
    }
  }, [zones, drivers]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      aria-label="Mapa con zonas y choferes en vivo"
    />
  );
}
