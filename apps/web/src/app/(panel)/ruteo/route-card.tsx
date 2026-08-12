"use client";

import * as React from "react";
import { CheckCircle2, Loader2, Printer } from "lucide-react";
import { api, type RouteDetail, type RouteItem } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

function formatKm(distanceM: number | null): string {
  if (distanceM == null) return "—";
  return `${(distanceM / 1000).toFixed(1)} km`;
}

function formatMin(durationS: number | null): string {
  if (durationS == null) return "—";
  return `${Math.round(durationS / 60)} min`;
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

export function RouteCard({
  route,
  allRoutes,
  onChanged,
}: {
  route: RouteItem;
  allRoutes: RouteItem[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [detail, setDetail] = React.useState<RouteDetail | null>(null);
  const [busy, setBusy] = React.useState(false);
  const canAdjust = route.status === "DRAFT" || route.status === "PROPOSED";

  const loadDetail = React.useCallback(async () => {
    try {
      const result = await api.get<RouteDetail>(`/api/routes/${route.id}`);
      setDetail(result);
    } catch {
      // el resumen de la card ya alcanza si el detalle falla
    }
  }, [route.id]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadDetail();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDetail]);

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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: route.colorHex ?? "#999" }}
            aria-hidden
          />
          <CardTitle>Ruta {route.routeNumber}</CardTitle>
          <Badge variant={STATUS_VARIANT[route.status]}>{route.status}</Badge>
        </div>
        <div className="text-text-muted flex items-center gap-3 text-xs">
          <span>{route.stopCount} paradas</span>
          <span>{formatKm(route.plannedDistanceM)}</span>
          <span>{formatMin(route.plannedDurationS)}</span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1.5">
          {detail?.stops.map((stop) => (
            <li
              key={stop.stopId}
              className="border-border flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {stop.sequence + 1}. {stop.rawAddressText ?? "(sin dirección)"}
                </div>
                <div className="text-text-muted truncate text-xs">
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
      </CardContent>
    </Card>
  );
}
