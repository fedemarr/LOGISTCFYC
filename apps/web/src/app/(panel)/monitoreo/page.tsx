"use client";

import * as React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTheme } from "next-themes";
import { Activity, BatteryMedium, Clock } from "lucide-react";
import { api, type LiveAlertType, type LiveRouteItem } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";

const DARK_TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const LIGHT_TILES = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const ALERT_BADGE: Record<
  LiveAlertType,
  { variant: "danger" | "warning" | "neutral"; label: string }
> = {
  GPS_SILENCE: { variant: "danger", label: "sin señal GPS" },
  STOPPED: { variant: "warning", label: "detenido" },
  BEHIND_SCHEDULE: { variant: "warning", label: "atrasada" },
};

const POLL_MS = 20_000;

/**
 * `/monitoreo` — flota en vivo (FASE 11): los choferes con ruta
 * IN_TRANSIT sobre un mapa, con su última ubicación (punto que se
 * refresca con polling cada 20 s) y alertas computadas (silencio GPS,
 * detenido, atrasado). El panel del costado lista cada ruta con sus
 * métricas; la polilínea del recorrido se puede cargar por ruta desde
 * `/api/routes/:id/tracking`.
 */
export default function MonitoreoPage() {
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = React.useState<LiveRouteItem[]>([]);
  const [selectedRouteId, setSelectedRouteId] = React.useState<string | null>(null);

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setStatus("loading");
    try {
      const data = await api.get<{ items: LiveRouteItem[] }>("/api/operations/live");
      setItems(data.items);
      setStatus("ready");
    } catch {
      if (!silent) setStatus("error");
    }
  }, []);

  React.useEffect(() => {
    void load();
    const poll = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(poll);
  }, [load]);

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Monitoreo" description="Flota en vivo (§10)" />
        <TableSkeleton columns={3} rows={4} />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Monitoreo" description="Flota en vivo (§10)" />
        <ErrorState onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="-m-4 flex h-[calc(100vh-2rem)] flex-col gap-0 sm:-m-6 sm:h-[calc(100vh-3rem)]">
      <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <PageHeader
          title="Monitoreo"
          description={`Choferes en la calle · polling cada ${POLL_MS / 1000} s`}
        />
      </div>

      {items.length === 0 ? (
        <div className="px-4 pt-4 sm:px-6">
          <Card>
            <CardContent className="p-0">
              <EmptyState
                title="No hay rutas en tránsito"
                description="Cuando un chofer arranque una ruta, aparece acá con su ubicación en vivo."
              />
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[320px_1fr]">
          <div className="border-border bg-surface flex min-h-0 flex-col gap-2 overflow-y-auto border-r p-3">
            {items.map((route) => (
              <button
                key={route.routeId}
                onClick={() => setSelectedRouteId(route.routeId)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  selectedRouteId === route.routeId
                    ? "border-border-2 bg-surface-3"
                    : "border-border bg-surface-2 hover:bg-surface-3"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-bold">
                    RUTA {String(route.routeNumber).padStart(3, "0")}
                  </span>
                  {route.alerts.length > 0 ? (
                    <span className="flex gap-1">
                      {route.alerts.map((a) => (
                        <Badge key={a.type} variant={ALERT_BADGE[a.type].variant}>
                          {ALERT_BADGE[a.type].label}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    <Badge variant="success">online</Badge>
                  )}
                </div>
                <p className="mt-1 text-sm">{route.driverName}</p>
                <p className="text-text-muted mt-0.5 flex items-center gap-1 text-xs">
                  <Activity className="size-3" />
                  {route.plate ?? "sin vehículo"}
                </p>
                <div className="text-text-muted mt-2 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1">
                    <BatteryMedium className="size-3" />
                    {route.batteryLevel != null
                      ? `${Math.round(route.batteryLevel * 100)}%`
                      : "—"}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {route.lastPingMinAgo != null
                      ? `ping ${route.lastPingMinAgo} min atrás`
                      : "sin pings"}
                  </span>
                </div>
                {route.speedMps != null && (
                  <p className="text-text-muted mt-1 text-xs">
                    {(route.speedMps * 3.6).toFixed(1)} km/h{" "}
                    {route.isMoving ? "· en movimiento" : "· detenido"}
                  </p>
                )}
              </button>
            ))}
          </div>
          <div className="hidden min-h-[420px] lg:block">
            <LiveFleetMap items={items} />
          </div>
        </div>
      )}
    </div>
  );
}

function LiveFleetMap({ items }: { items: LiveRouteItem[] }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const tileLayerRef = React.useRef<L.TileLayer | null>(null);
  const markersRef = React.useRef<Array<{ routeId: string; marker: L.Marker }>>([]);
  const { resolvedTheme } = useTheme();

  const positioned = items.filter(
    (r): r is LiveRouteItem & { lat: number; lng: number } =>
      r.lat != null && r.lng != null,
  );

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [-34.56, -58.55],
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
  }, []);

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

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const { marker } of markersRef.current) marker.remove();
    markersRef.current = [];

    for (const route of positioned) {
      const color = route.alerts.length > 0 ? "#EF4444" : "#22C55E";
      const icon = L.divIcon({
        className: "",
        html: `<div style="position:relative;width:16px;height:16px;border-radius:50%;background:${color};border:2px solid var(--bg,#0f1115);box-shadow:0 0 0 4px ${color}33"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      const marker = L.marker([route.lat, route.lng], { icon }).addTo(map);
      marker.bindPopup(
        `<div style="font-family:var(--font-sans);font-size:12px">
          <div style="font-family:var(--font-mono);font-weight:700">RUTA ${String(route.routeNumber).padStart(3, "0")}</div>
          <div style="font-weight:600">${route.driverName}</div>
          ${route.plate ? `<div style="color:#8B919E">${route.plate}</div>` : ""}
          ${route.alerts.length > 0 ? `<div style="color:#EF4444">${route.alerts.map((a) => a.message).join(" · ")}</div>` : ""}
          <div style="color:#8B919E">ping ${route.lastPingMinAgo ?? "—"} min atrás</div>
        </div>`,
      );
      markersRef.current.push({ routeId: route.routeId, marker });
    }

    const all: L.LatLngTuple[] = positioned.map((r) => [r.lat, r.lng]);
    if (all.length > 0) {
      map.fitBounds(L.latLngBounds(all), { padding: [60, 60], maxZoom: 13 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positioned.length]);

  return (
    <div className="bg-bg relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="h-full w-full" />
      {positioned.length === 0 && (
        <div className="text-text-muted pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center text-sm">
          Esperando la primera ubicación de los choferes…
        </div>
      )}
    </div>
  );
}
