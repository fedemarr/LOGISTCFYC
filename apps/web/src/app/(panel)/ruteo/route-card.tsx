"use client";

import * as React from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  MapPin,
  Printer,
  QrCode,
  Truck,
} from "lucide-react";
import QRCode from "qrcode";
import {
  api,
  type ContainerItem,
  type DriverItem,
  type RouteDetail,
  type RouteItem,
} from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function formatKm(distanceM: number | null): string {
  if (distanceM == null) return "\u2014";
  return (distanceM / 1000).toFixed(1);
}

function formatDuration(durationS: number | null): string {
  if (durationS == null) return "\u2014";
  const totalMin = Math.round(durationS / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

const STATUS_VARIANT: Record<RouteItem["status"], "neutral" | "info" | "success"> = {
  DRAFT: "neutral",
  PROPOSED: "info",
  APPROVED: "success",
  ASSIGNED: "success",
  LOADING: "success",
  LOADED: "success",
  IN_TRANSIT: "success",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

function capacityColor(pct: number): string {
  if (pct > 100) return "var(--danger)";
  if (pct > 85) return "var(--warning)";
  return "var(--success)";
}

export function RouteCard({
  route,
  allRoutes,
  containers,
  detail,
  hovered,
  onHoverChange,
  onChanged,
}: {
  route: RouteItem;
  allRoutes: RouteItem[];
  containers: ContainerItem[];
  detail: RouteDetail | undefined;
  hovered: boolean;
  onHoverChange: (routeId: string | null) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [drivers, setDrivers] = React.useState<DriverItem[]>([]);
  const [routeQrDataUrl, setRouteQrDataUrl] = React.useState<string | null>(null);
  const [showQr, setShowQr] = React.useState(false);
  const [stopsExpanded, setStopsExpanded] = React.useState(false);
  const canAdjust = route.status === "DRAFT" || route.status === "PROPOSED";
  const canAssignContainer =
    route.status === "DRAFT" ||
    route.status === "PROPOSED" ||
    route.status === "APPROVED";
  const color = route.colorHex ?? "var(--muted)";
  const pct = route.capacityPackages
    ? Math.round((route.stopCount / route.capacityPackages) * 100)
    : null;
  const stopCount = detail?.stops.length ?? route.stopCount;

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page = await api.get<{ items: DriverItem[] }>("/api/drivers");
        if (!cancelled) setDrivers(page.items);
      } catch {
        // no bloquea la tarjeta
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAssignDriver(driverId: string) {
    setBusy(true);
    try {
      await api.patch(`/api/routes/${route.id}`, {
        driverId: driverId === "" ? null : driverId,
      });
      toast({
        title: driverId === "" ? "Chofer desasignado" : "Chofer habilitado para la ruta",
        variant: "success",
      });
      onChanged();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo asignar el chofer",
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function loadQr() {
    try {
      const result = await api.get<{ payload: string }>(`/api/routes/${route.id}/qr`);
      setRouteQrDataUrl(
        await QRCode.toDataURL(result.payload, { width: 200, margin: 1 }),
      );
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo generar el QR",
        variant: "error",
      });
    }
  }

  async function handleAssignContainer(containerId: string) {
    setBusy(true);
    try {
      await api.patch(`/api/routes/${route.id}`, {
        containerId: containerId === "" ? null : containerId,
      });
      toast({ title: "Contenedor asignado", variant: "success" });
      onChanged();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo asignar el contenedor",
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleReassign(packageId: string, toRouteId: string) {
    if (toRouteId === route.id) return;
    setBusy(true);
    try {
      await api.post(`/api/routes/${toRouteId}/reassign`, { packageId });
      toast({ title: "Bulto movido de ruta", variant: "success" });
      onChanged();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo mover el bulto",
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    setBusy(true);
    try {
      await api.post(`/api/routes/${route.id}/approve`);
      toast({
        title: `Ruta ${String(route.routeNumber).padStart(3, "0")} aprobada`,
        variant: "success",
      });
      onChanged();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo aprobar la ruta",
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  function toggleQr() {
    const next = !showQr;
    setShowQr(next);
    if (next && !routeQrDataUrl) void loadQr();
  }

  return (
    <div
      className={cn(
        "bg-surface-2 border-border relative overflow-hidden rounded-lg border transition-all",
        hovered && "border-border-2 shadow-md",
      )}
      onMouseEnter={() => onHoverChange(route.id)}
      onMouseLeave={() => onHoverChange(null)}
    >
      <span className="spine" style={{ background: color }} aria-hidden />

      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <div className="flex items-center gap-2.5">
          <span className="font-data text-base font-bold tracking-wide" style={{ color }}>
            {String(route.routeNumber).padStart(3, "0")}
          </span>
          <Badge variant={STATUS_VARIANT[route.status]}>{route.status}</Badge>
        </div>
        <span className="font-data text-text-muted text-xs">
          {stopCount} {stopCount === 1 ? "parada" : "paradas"}
        </span>
      </div>

      <div className="border-border mx-4 border-t border-dashed" />
      <div className="px-4 py-2.5">
        {canAssignContainer ? (
          <div className="flex items-center gap-2">
            <Truck className="text-text-muted size-4 shrink-0" />
            <Select
              aria-label="Asignar chofer"
              className="w-full"
              value={route.assignedDriverId ?? ""}
              disabled={busy}
              onChange={(e) => void handleAssignDriver(e.target.value)}
            >
              <option value="">Sin chofer asignado</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <Truck className="text-text-muted size-4 shrink-0" />
            <span className="truncate">
              {route.driverName ?? (
                <span className="text-status-warning">Sin asignar</span>
              )}
            </span>
            {route.vehiclePlate && (
              <span className="font-data text-text-muted-2 ml-auto text-xs">
                {route.vehiclePlate}
              </span>
            )}
          </div>
        )}
      </div>

      {canAssignContainer && (
        <>
          <div className="border-border mx-4 border-t border-dashed" />
          <div className="px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-text-muted size-4 shrink-0 text-center text-xs">
                C
              </span>
              <Select
                aria-label="Asignar contenedor"
                className="w-full"
                value={route.containerId ?? ""}
                disabled={busy}
                onChange={(e) => void handleAssignContainer(e.target.value)}
              >
                <option value="">Sin contenedor</option>
                {containers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </>
      )}
      {!canAssignContainer && route.containerCode && (
        <>
          <div className="border-border mx-4 border-t border-dashed" />
          <div className="px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-text-muted size-4 shrink-0 text-center text-xs">
                C
              </span>
              <span className="font-data">{route.containerCode}</span>
            </div>
          </div>
        </>
      )}

      <div className="border-border mx-4 border-t border-dashed" />
      <div className="px-4 py-3">
        <div className="mb-2 flex gap-5">
          <Stat value={route.stopCount} label="Bultos" />
          <Stat value={formatKm(route.plannedDistanceM)} label="km" />
          <Stat value={formatDuration(route.plannedDurationS)} label="Tiempo" />
        </div>
        {pct != null && (
          <div className="flex items-center gap-2">
            <div className="bg-surface h-[5px] flex-1 overflow-hidden rounded-full">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(pct, 100)}%`,
                  background: capacityColor(pct),
                }}
              />
            </div>
            <span className="font-data text-text-muted min-w-8 text-right text-[11px]">
              {pct}%
            </span>
          </div>
        )}
      </div>

      <div className="border-border mx-4 border-t border-dashed" />
      <div className="flex flex-wrap gap-2 px-4 py-3">
        {canAdjust && (
          <Button onClick={() => void handleApprove()} disabled={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Activar ruta
          </Button>
        )}
        {route.status === "APPROVED" && (
          <>
            <Button
              render={
                <a
                  href={`/api/routes/${route.id}/labels?format=thermal`}
                  target="_blank"
                  rel="noreferrer"
                />
              }
              variant="outline"
            >
              <Printer className="size-4" />
              Etiquetas
            </Button>
            <Button variant="outline" onClick={toggleQr}>
              <QrCode className="size-4" />
              QR ruta
            </Button>
          </>
        )}
      </div>

      {showQr && route.status === "APPROVED" && (
        <>
          <div className="border-border mx-4 border-t" />
          <div className="flex flex-col items-center gap-2 px-4 py-4">
            <p className="text-text-muted text-center text-xs">
              El chofer escanea este QR desde la app para abrir la custodia
            </p>
            {routeQrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL de QR
              <img
                src={routeQrDataUrl}
                alt={`QR de la ruta ${route.routeNumber}`}
                className="size-48 rounded-lg border"
              />
            ) : (
              <div className="flex size-48 items-center justify-center rounded-lg border">
                <Loader2 className="size-6 animate-spin" />
              </div>
            )}
            <p className="font-data text-text-muted-2 text-center text-[11px]">
              FYC-ROUTE-{route.id.slice(0, 8)}...
            </p>
          </div>
        </>
      )}

      {detail && detail.stops.length > 0 && (
        <>
          <button
            type="button"
            className="border-border flex w-full items-center justify-between border-t px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--surface)]"
            onClick={() => setStopsExpanded(!stopsExpanded)}
          >
            <span className="flex items-center gap-1.5">
              <MapPin className="text-text-muted size-3.5" />
              {detail.stops.length} {detail.stops.length === 1 ? "parada" : "paradas"}
            </span>
            {stopsExpanded ? (
              <ChevronUp className="text-text-muted size-4" />
            ) : (
              <ChevronDown className="text-text-muted size-4" />
            )}
          </button>
          {stopsExpanded && (
            <div className="border-border border-t">
              <ul className="flex flex-col">
                {detail.stops.map((stop) => (
                  <li
                    key={stop.stopId}
                    className="border-border flex items-center justify-between gap-2 border-b px-4 py-2 text-sm last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {stop.sequence + 1}. {stop.rawAddressText ?? "(sin direccion)"}
                      </div>
                      <div className="text-text-muted font-data truncate text-xs">
                        {stop.recipientName ?? "\u2014"} � #{stop.internalCode}
                      </div>
                    </div>
                    {canAdjust && allRoutes.length > 1 && (
                      <Select
                        aria-label="Mover a otra ruta"
                        className="w-32 shrink-0"
                        value={route.id}
                        disabled={busy}
                        onChange={(e) =>
                          void handleReassign(stop.packageId, e.target.value)
                        }
                      >
                        {allRoutes.map((r) => (
                          <option key={r.id} value={r.id}>
                            Ruta {r.routeNumber}
                          </option>
                        ))}
                      </Select>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {!detail && (
        <div className="border-border border-t px-4 py-2.5">
          <span className="text-text-muted text-xs">Cargando paradas...</span>
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <div className="font-data text-sm font-medium">{value}</div>
      <div className="text-text-muted-2 text-[10px] uppercase tracking-wide">{label}</div>
    </div>
  );
}
