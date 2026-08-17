"use client";

import * as React from "react";
import { CheckCircle2, Loader2, Printer, QrCode } from "lucide-react";
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
import {
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  const [qrDialogOpen, setQrDialogOpen] = React.useState(false);
  const canAdjust = route.status === "DRAFT" || route.status === "PROPOSED";
  // El contenedor se puede asignar/cambiar hasta APPROVED (§9.2/§9.3) —
  // una vez que el chofer arrancó custodia (ASSIGNED en adelante) el
  // contenedor físico ya está en la calle, `assignRouteContainer` lo
  // rechaza server-side igual, esto solo evita mostrar el control cuando
  // ya no sirve para nada.
  const canAssignContainer =
    route.status === "DRAFT" ||
    route.status === "PROPOSED" ||
    route.status === "APPROVED";
  const color = route.colorHex ?? "var(--muted)";
  const pct = route.capacityPackages
    ? Math.round((route.stopCount / route.capacityPackages) * 100)
    : null;

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page = await api.get<{ items: DriverItem[] }>("/api/drivers");
        if (!cancelled) setDrivers(page.items);
      } catch {
        // no bloquea la tarjeta — sin esto solo no se puede cambiar chofer
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

  async function openRouteQr() {
    try {
      const result = await api.get<{ payload: string }>(`/api/routes/${route.id}/qr`);
      setRouteQrDataUrl(
        await QRCode.toDataURL(result.payload, { width: 240, margin: 1 }),
      );
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo generar el QR de la ruta",
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

      {canAssignContainer ? (
        <div className="mb-2.5 flex items-center gap-2 text-sm">
          <span className="text-text-muted shrink-0">Contenedor</span>
          <Select
            aria-label="Asignar contenedor"
            className="w-full"
            value={route.containerId ?? ""}
            disabled={busy}
            onChange={(e) => void handleAssignContainer(e.target.value)}
          >
            <option value="">Sin asignar</option>
            {containers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        route.containerCode && (
          <div className="text-text-muted mb-2.5 text-sm">
            Contenedor: <span className="font-data">{route.containerCode}</span>
          </div>
        )
      )}

      {canAssignContainer ? (
        <div className="mb-2.5 flex items-center gap-2 text-sm">
          <span className="text-text-muted shrink-0">Chofer</span>
          <Select
            aria-label="Asignar chofer"
            className="w-full"
            value={route.assignedDriverId ?? ""}
            disabled={busy}
            onChange={(e) => void handleAssignDriver(e.target.value)}
          >
            <option value="">Sin asignar</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        route.driverName && (
          <div className="text-text-muted mb-2.5 text-sm">
            Chofer: <span className="font-data">{route.driverName}</span>
          </div>
        )
      )}

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

      {/* Acciones ARRIBA de la lista de paradas, a propósito: con muchas
          paradas el panel de rutas puede requerir scroll para llegar al
          final, y "Aprobar"/"Imprimir etiquetas" son la acción principal
          de la tarjeta — no deberían depender de scrollear hasta el
          fondo para encontrarlas. */}
      <div className="mb-2.5 flex gap-2">
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
        <DialogRoot
          open={qrDialogOpen}
          onOpenChange={(v) => {
            setQrDialogOpen(v);
            if (v) void openRouteQr();
          }}
        >
          <DialogTrigger
            render={
              <Button variant="outline" size="sm">
                <QrCode className="size-4" />
                QR ruta
              </Button>
            }
          />
          <DialogContent className="max-w-xs">
            <DialogTitle>Ruta {String(route.routeNumber).padStart(3, "0")}</DialogTitle>
            <DialogDescription>
              Escaneá desde la app del chofer: se abre la custodia con el conteo de esta
              ruta (§9.3 + FASE A). El QR codifica solo la ruta, el detalle (bultos, zona,
              hoja) se resuelve desde el servidor.
            </DialogDescription>
            <div className="flex flex-col items-center gap-2 py-2">
              {routeQrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URL de QR, next/image no lo optimiza
                <img
                  src={routeQrDataUrl}
                  alt={`QR de la ruta ${route.routeNumber}`}
                  className="size-60 rounded-md border"
                />
              ) : (
                <Loader2 className="size-8 animate-spin" />
              )}
            </div>
          </DialogContent>
        </DialogRoot>
      </div>

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
