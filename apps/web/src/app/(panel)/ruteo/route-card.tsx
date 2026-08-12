"use client";

import * as React from "react";
import { CheckCircle2, Loader2, Printer } from "lucide-react";
import { api, type RouteDetail, type RouteItem } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function formatKm(distanceM: number | null): string {
  if (distanceM == null) return "—";
  return (distanceM / 1000).toFixed(1);
}

function formatDuration(durationS: number | null): string {
  if (durationS == null) return "—";
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

/** Verde <85%, ámbar 85-100%, rojo >100% (PROMPT-FRONTEND-V2 §6.1). */
function capacityColor(pct: number): string {
  if (pct > 100) return "var(--danger)";
  if (pct > 85) return "var(--warning)";
  return "var(--success)";
}

export function RouteCard({
  route,
  allRoutes,
  detail,
  hovered,
  onHoverChange,
  onChanged,
}: {
  route: RouteItem;
  allRoutes: RouteItem[];
  detail: RouteDetail | undefined;
  hovered: boolean;
  onHoverChange: (routeId: string | null) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const canAdjust = route.status === "DRAFT" || route.status === "PROPOSED";
  const color = route.colorHex ?? "var(--muted)";
  const pct = route.capacityPackages
    ? Math.round((route.stopCount / route.capacityPackages) * 100)
    : null;

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
        title: `Ruta ${route.routeNumber} aprobada — bultos congelados`,
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

  return (
    <div
      className={cn(
        "bg-surface-2 border-border relative overflow-hidden rounded-[var(--radius-md)] border py-3 pl-[18px] pr-3 transition-all",
        hovered && "border-border-2",
      )}
      onMouseEnter={() => onHoverChange(route.id)}
      onMouseLeave={() => onHoverChange(null)}
    >
      <span className="spine" style={{ background: color }} aria-hidden />

      <div className="mb-2 flex items-center justify-between">
        <span className="font-data text-sm font-bold tracking-wide">
          RUTA {String(route.routeNumber).padStart(3, "0")}
        </span>
        <Badge variant={STATUS_VARIANT[route.status]}>{route.status}</Badge>
      </div>

      <div className="mb-2.5 flex items-center gap-1.5 text-sm">
        <span className="bg-surface-3 text-text-muted grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-bold">
          {route.driverName
            ? route.driverName
                .split(" ")
                .map((w) => w[0]?.toUpperCase())
                .slice(0, 2)
                .join("")
            : "—"}
        </span>
        {route.driverName ?? <span className="text-status-warning">Sin asignar</span>}
        {route.vehiclePlate && (
          <span className="font-data text-text-muted-2 text-xs">
            · {route.vehiclePlate}
          </span>
        )}
      </div>

      <div className="mb-2.5 flex gap-3.5">
        <Stat value={route.stopCount} label="Bultos" />
        <Stat value={formatKm(route.plannedDistanceM)} label="km" />
        <Stat value={formatDuration(route.plannedDurationS)} label="Estimado" />
      </div>

      {pct != null && (
        <div className="mb-2.5 flex items-center gap-2">
          <div className="bg-surface h-[5px] flex-1 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(pct, 100)}%`, background: capacityColor(pct) }}
            />
          </div>
          <span className="font-data text-text-muted min-w-8 text-right text-[11px]">
            {pct}%
          </span>
        </div>
      )}

      <ul className="mb-2.5 flex flex-col gap-1.5">
        {detail?.stops.map((stop) => (
          <li
            key={stop.stopId}
            className="border-border flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">
                {stop.sequence + 1}. {stop.rawAddressText ?? "(sin dirección)"}
              </div>
              <div className="text-text-muted font-data truncate text-xs">
                {stop.recipientName ?? "—"} · #{stop.internalCode}
              </div>
            </div>
            {canAdjust && allRoutes.length > 1 && (
              <Select
                aria-label="Mover a otra ruta"
                className="w-32 shrink-0"
                value={route.id}
                disabled={busy}
                onChange={(e) => void handleReassign(stop.packageId, e.target.value)}
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
        {!detail && <li className="text-text-muted text-sm">Cargando paradas…</li>}
      </ul>

      <div className="flex gap-2">
        {canAdjust && (
          <Button onClick={() => void handleApprove()} disabled={busy} size="sm">
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Aprobar
          </Button>
        )}
        {route.status === "APPROVED" && (
          <Button
            render={
              <a
                href={`/api/routes/${route.id}/labels?format=thermal`}
                target="_blank"
                rel="noreferrer"
              />
            }
            variant="outline"
            size="sm"
          >
            <Printer className="size-4" />
            Imprimir etiquetas
          </Button>
        )}
      </div>
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
