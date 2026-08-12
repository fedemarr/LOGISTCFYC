"use client";

import * as React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTheme } from "next-themes";
import type { RouteDetail, RouteItem } from "@/lib/api/client";

/**
 * Mapa real del planificador (PROMPT-FRONTEND-V2 §3/§6.1) — alcance
 * acotado a propósito respecto de la especificación completa (ver
 * docs/DECISIONES.md ADR-039): pines coloreados por ruta + trazado +
 * depósito + resalte al pasar el mouse por una tarjeta, con tiles Carto
 * gratuitos (sin `NEXT_PUBLIC_MAPTILER_KEY`, todavía no conseguida). NO
 * incluye: territorios (casco convexo con turf), clustering por zoom, ni
 * arrastrar-para-mover-de-ruta sobre el pin — eso queda para cuando haya
 * volumen real que lo justifique.
 *
 * Leaflet, no MapLibre GL (ver docs/DECISIONES.md ADR-043): MapLibre v6
 * carga su worker de tiles como módulo ES (`maplibre-gl-worker.mjs`) —
 * en producción (Vercel) ese chunk devolvía el fallback HTML de Next en
 * vez del JS, y el navegador lo rechazaba por MIME type ("Failed to load
 * module script"). Leaflet usa tiles raster simples (imágenes), sin web
 * workers de por medio — cero superficie para ese bug. Mismos tiles
 * gratuitos de CartoCDN, en formato PNG en vez de vectorial.
 */

const DARK_TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const LIGHT_TILES = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

interface StopPoint {
  routeId: string;
  color: string;
  sequence: number;
  lat: number;
  lng: number;
  internalCode: string;
  rawAddressText: string | null;
}

export function RouteMap({
  routes,
  details,
  depot,
  hoveredRouteId,
}: {
  routes: RouteItem[];
  details: Record<string, RouteDetail>;
  depot: { lat: number; lng: number } | null;
  hoveredRouteId: string | null;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const tileLayerRef = React.useRef<L.TileLayer | null>(null);
  const depotMarkerRef = React.useRef<L.Marker | null>(null);
  const pinLayersRef = React.useRef<Array<{ routeId: string; marker: L.Marker }>>([]);
  const lineLayersRef = React.useRef<Array<{ routeId: string; line: L.Polyline }>>([]);
  const { resolvedTheme } = useTheme();

  const points: StopPoint[] = React.useMemo(
    () =>
      routes.flatMap((route) =>
        (details[route.id]?.stops ?? [])
          .filter(
            (s): s is typeof s & { lat: number; lng: number } =>
              s.lat != null && s.lng != null,
          )
          .map((s) => ({
            routeId: route.id,
            color: route.colorHex ?? "#8B919E",
            sequence: s.sequence,
            lat: s.lat,
            lng: s.lng,
            internalCode: s.internalCode,
            rawAddressText: s.rawAddressText,
          })),
      ),
    [routes, details],
  );

  const lines = React.useMemo(() => {
    if (!depot) return [];
    return routes.map((route) => {
      const stops = (details[route.id]?.stops ?? [])
        .filter(
          (s): s is typeof s & { lat: number; lng: number } =>
            s.lat != null && s.lng != null,
        )
        .sort((a, b) => a.sequence - b.sequence);
      const coords: L.LatLngTuple[] = [
        [depot.lat, depot.lng],
        ...stops.map((s): L.LatLngTuple => [s.lat, s.lng]),
        [depot.lat, depot.lng],
      ];
      return { routeId: route.id, color: route.colorHex ?? "#8B919E", coords };
    });
  }, [routes, details, depot]);

  // Monta el mapa una sola vez.
  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: depot ? [depot.lat, depot.lng] : [-34.56, -58.55],
      zoom: 11,
      zoomControl: false,
      attributionControl: false,
    });
    L.control.zoom({ position: "topright" }).addTo(map);
    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se monta una sola vez a propósito
  }, []);

  // Tiles según el tema — se saca la capa vieja y se pone la nueva (no
  // hay "restyle" en Leaflet como en MapLibre, es una capa de imágenes).
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileLayerRef.current?.remove();
    const url = resolvedTheme === "light" ? LIGHT_TILES : DARK_TILES;
    tileLayerRef.current = L.tileLayer(url, {
      subdomains: "abcd",
      maxZoom: 20,
      attribution: TILE_ATTRIBUTION,
    }).addTo(map);
  }, [resolvedTheme]);

  function pinIcon(color: string, seq: number, dimmed: boolean): L.DivIcon {
    return L.divIcon({
      className: "",
      html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:1.5px solid var(--bg,#0f1115);display:grid;place-items:center;font:700 11px var(--font-sans,sans-serif);color:#0F1115;opacity:${dimmed ? 0.18 : 0.95};box-shadow:0 1px 3px rgba(0,0,0,.4)">${seq}</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
  }

  // Pines + trazado — se recrean cuando cambian los datos (paquetes,
  // rutas). Volumen esperado (decenas de paradas) no justifica un diff
  // incremental como el que hacía MapLibre con `setData`.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const { marker } of pinLayersRef.current) marker.remove();
    for (const { line } of lineLayersRef.current) line.remove();
    pinLayersRef.current = [];
    lineLayersRef.current = [];

    for (const line of lines) {
      const dimmed = hoveredRouteId != null && hoveredRouteId !== line.routeId;
      const poly = L.polyline(line.coords, {
        color: line.color,
        weight: 2,
        dashArray: "2,6",
        opacity: dimmed ? 0.18 : 0.6,
      }).addTo(map);
      lineLayersRef.current.push({ routeId: line.routeId, line: poly });
    }

    for (const p of points) {
      const dimmed = hoveredRouteId != null && hoveredRouteId !== p.routeId;
      const marker = L.marker([p.lat, p.lng], {
        icon: pinIcon(p.color, p.sequence + 1, dimmed),
      })
        .addTo(map)
        .bindPopup(
          `<div style="font-family:var(--font-sans);font-size:12px">
            <div style="font-family:var(--font-mono);font-weight:700;margin-bottom:2px">#${p.internalCode}</div>
            <div style="color:#8B919E">${p.rawAddressText ?? ""}</div>
          </div>`,
        );
      pinLayersRef.current.push({ routeId: p.routeId, marker });
    }
    // hoveredRouteId se aplica acá también (color inicial correcto) pero
    // el efecto de abajo es el que lo actualiza sin recrear las capas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, lines]);

  // Resalte al pasar el mouse por una tarjeta de ruta (§3): la ruta al
  // 100%, las demás bien tenues — sin recrear capas.
  React.useEffect(() => {
    for (const { routeId, marker } of pinLayersRef.current) {
      const dimmed = hoveredRouteId != null && hoveredRouteId !== routeId;
      marker.setOpacity(dimmed ? 0.18 : 0.95);
    }
    for (const { routeId, line } of lineLayersRef.current) {
      const dimmed = hoveredRouteId != null && hoveredRouteId !== routeId;
      line.setStyle({ opacity: dimmed ? 0.18 : 0.6 });
    }
  }, [hoveredRouteId]);

  // Depósito.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    depotMarkerRef.current?.remove();
    depotMarkerRef.current = null;
    if (!depot) return;
    const icon = L.divIcon({
      className: "",
      html:
        '<div style="width:28px;height:28px;border-radius:8px;background:var(--text,#fff);display:grid;place-items:center;border:2px solid var(--bg,#0f1115);box-shadow:0 2px 6px rgba(0,0,0,.3)">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--bg,#0f1115)" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    depotMarkerRef.current = L.marker([depot.lat, depot.lng], { icon }).addTo(map);
  }, [depot]);

  // Encuadre automático al cargar / cuando cambian los puntos.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const all: L.LatLngTuple[] = depot ? [[depot.lat, depot.lng]] : [];
    for (const p of points) all.push([p.lat, p.lng]);
    if (all.length === 0) return;
    map.fitBounds(L.latLngBounds(all), { padding: [60, 60], maxZoom: 14 });
    // Solo al cambiar la cantidad de puntos (no en cada pequeño ajuste) —
    // evita pelear con el usuario si está navegando el mapa a mano.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length, depot]);

  return (
    <div className="bg-bg relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="h-full w-full" />
      {points.length === 0 && (
        <div className="text-text-muted pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center text-sm">
          Generá la propuesta de rutas para ver los pines en el mapa
        </div>
      )}
    </div>
  );
}
