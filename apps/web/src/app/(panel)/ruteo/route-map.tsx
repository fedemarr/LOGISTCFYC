"use client";

import * as React from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
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
 */

const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const LIGHT_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

interface StopPoint {
  routeId: string;
  routeNumber: number;
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
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const depotMarkerRef = React.useRef<maplibregl.Marker | null>(null);
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
            routeNumber: route.routeNumber,
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

  const geojson = React.useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: points.map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: {
          routeId: p.routeId,
          color: p.color,
          seq: p.sequence + 1,
          code: p.internalCode,
          address: p.rawAddressText ?? "",
        },
      })),
    }),
    [points],
  );

  const linesGeojson = React.useMemo(() => {
    if (!depot) return { type: "FeatureCollection" as const, features: [] };
    return {
      type: "FeatureCollection" as const,
      features: routes.map((route) => {
        const stops = (details[route.id]?.stops ?? [])
          .filter(
            (s): s is typeof s & { lat: number; lng: number } =>
              s.lat != null && s.lng != null,
          )
          .sort((a, b) => a.sequence - b.sequence);
        const coords = [
          [depot.lng, depot.lat],
          ...stops.map((s) => [s.lng, s.lat]),
          [depot.lng, depot.lat],
        ];
        return {
          type: "Feature" as const,
          geometry: { type: "LineString" as const, coordinates: coords },
          properties: { routeId: route.id, color: route.colorHex ?? "#8B919E" },
        };
      }),
    };
  }, [routes, details, depot]);

  const addLayers = React.useCallback(
    (map: MapLibreMap) => {
      if (map.getSource("route-lines")) return;

      map.addSource("route-lines", { type: "geojson", data: linesGeojson });
      map.addLayer({
        id: "route-lines",
        type: "line",
        source: "route-lines",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2,
          "line-dasharray": [2, 1.5],
          "line-opacity": 0.6,
        },
      });

      map.addSource("route-pins", { type: "geojson", data: geojson });
      map.addLayer({
        id: "route-pins-circle",
        type: "circle",
        source: "route-pins",
        paint: {
          "circle-radius": 11,
          "circle-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": resolvedTheme === "light" ? "#ffffff" : "#0f1115",
          "circle-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "route-pins-label",
        type: "symbol",
        source: "route-pins",
        layout: {
          "text-field": ["to-string", ["get", "seq"]],
          "text-size": 11,
          "text-font": ["Noto Sans Bold"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#0F1115" },
      });

      map.on("click", "route-pins-circle", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const props = f.properties as { code: string; address: string };
        const geometry = f.geometry as { coordinates: [number, number] };
        new maplibregl.Popup({ closeButton: true, offset: 12 })
          .setLngLat(geometry.coordinates)
          .setHTML(
            `<div style="font-family:var(--font-sans);font-size:12px">
              <div style="font-family:var(--font-mono);font-weight:700;margin-bottom:2px">#${props.code}</div>
              <div style="color:#8B919E">${props.address}</div>
            </div>`,
          )
          .addTo(map);
      });
      map.on("mouseenter", "route-pins-circle", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "route-pins-circle", () => {
        map.getCanvas().style.cursor = "";
      });
    },
    [geojson, linesGeojson, resolvedTheme],
  );

  // Monta el mapa una sola vez.
  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: resolvedTheme === "light" ? LIGHT_STYLE : DARK_STYLE,
      center: depot ? [depot.lng, depot.lat] : [-58.55, -34.56],
      zoom: 11,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    map.on("load", () => addLayers(map));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se monta una sola vez a propósito
  }, []);

  // Cambio de tema (§3): estilo distinto, no un filtro CSS — hay que
  // volver a agregar las capas después de `setStyle` porque las destruye.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const target = resolvedTheme === "light" ? LIGHT_STYLE : DARK_STYLE;
    if (!map.isStyleLoaded()) return;
    map.setStyle(target);
    map.once("styledata", () => addLayers(map));
  }, [resolvedTheme, addLayers]);

  // Datos actualizados (mover un bulto de ruta, nueva propuesta, etc.):
  // `setData`, nunca destruir y recrear capas.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const pinsSource = map.getSource("route-pins") as
      maplibregl.GeoJSONSource | undefined;
    pinsSource?.setData(geojson);
    const linesSource = map.getSource("route-lines") as
      maplibregl.GeoJSONSource | undefined;
    linesSource?.setData(linesGeojson);
  }, [geojson, linesGeojson]);

  // Depósito.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    depotMarkerRef.current?.remove();
    if (!depot) return;
    const el = document.createElement("div");
    el.style.cssText =
      "width:28px;height:28px;border-radius:8px;background:var(--text);display:grid;place-items:center;border:2px solid var(--bg);box-shadow:0 2px 6px rgba(0,0,0,.3)";
    el.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
    depotMarkerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([depot.lng, depot.lat])
      .addTo(map);
  }, [depot]);

  // Resalte al pasar el mouse por una tarjeta de ruta (§3): la ruta al
  // 100%, las demás a 0.18 — vía `setPaintProperty`, sin re-render.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getLayer("route-pins-circle")) return;
    const dimmed = 0.18;
    const opacityExpr: maplibregl.DataDrivenPropertyValueSpecification<number> =
      hoveredRouteId
        ? ["case", ["==", ["get", "routeId"], hoveredRouteId], 0.95, dimmed]
        : 0.95;
    const lineOpacityExpr: maplibregl.DataDrivenPropertyValueSpecification<number> =
      hoveredRouteId
        ? ["case", ["==", ["get", "routeId"], hoveredRouteId], 0.85, dimmed]
        : 0.6;
    map.setPaintProperty("route-pins-circle", "circle-opacity", opacityExpr);
    map.setPaintProperty("route-lines", "line-opacity", lineOpacityExpr);
  }, [hoveredRouteId]);

  // Encuadre automático al cargar / cuando cambian los puntos.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const all = depot ? [[depot.lng, depot.lat] as [number, number]] : [];
    for (const p of points) all.push([p.lng, p.lat]);
    if (all.length === 0) return;
    const bounds = all.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(all[0], all[0]),
    );
    map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 400 });
    // Solo al cambiar la cantidad de puntos (no en cada pequeño ajuste) —
    // evita pelear con el usuario si está navegando el mapa a mano.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length, depot]);

  return (
    <div className="bg-bg relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="h-full w-full" />
      {points.length === 0 && (
        <div className="text-text-muted pointer-events-none absolute inset-0 flex items-center justify-center text-sm">
          Generá la propuesta de rutas para ver los pines en el mapa
        </div>
      )}
    </div>
  );
}
