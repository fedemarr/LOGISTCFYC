"use client";

import * as React from "react";
import { AlertTriangle, Boxes, CheckCheck, Download, Route, Truck } from "lucide-react";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { ErrorState, TableSkeleton } from "@/components/states";
import { useToast } from "@/components/ui/toast";

interface OperationsDashboard {
  packagesByStatus: { status: string; count: number }[];
  routesActive: number;
  routesCompletedToday: number;
  driversOnRoute: number;
  driversOnline: number;
  deliveriesToday: number;
  failuresToday: number;
}

interface DeliveryMetrics {
  range: { from: string; to: string };
  deliveries: number;
  failures: number;
  successRate: number;
  deliveredByDriver: { driverId: string; driverName: string; count: number }[];
  deliveriesPerDay: { day: string; count: number }[];
  packagesPerHour: number | null;
  totalKm: number | null;
  avgSecondsPerDelivery: number | null;
  incidents: number;
  retries: number;
}

interface DayReconciliation {
  date: string;
  operationId: string | null;
  operationStatus: string | null;
  loaded: number;
  delivered: number;
  failed: number;
  returned: number;
  difference: number;
  balanced: boolean;
  suspicious: { internalCode: string; status: string }[];
}

const PACKAGE_STATUS_LABELS: Record<string, string> = {
  PENDIENTE_RESOLUCION: "Pendiente resolución",
  RECIBIDO: "Recibido",
  GEOCODIFICADO: "Geocodificado",
  ASIGNADO: "Asignado",
  CARGADO: "Cargado",
  EN_REPARTO: "En reparto",
  EN_DOMICILIO: "En domicilio",
  ENTREGADO: "Entregado",
  FALLA_REPORTADA: "Falla reportada",
  REPROGRAMADO: "Reprogramado",
  DEVUELTO: "Devuelto",
  EXTRAVIADO: "Extraviado",
  DANIADO: "Dañado",
  CANCELADO: "Cancelado",
};

const RANGE_DAYS: Record<"7d" | "30d" | "90d", number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * `/metricas` — dashboard operativo + métricas de reparto + cierre de día
 * (§9.9) + exportación CSV (§7). FASE 12. Accesible a admin/dispatcher/
 * warehouse (el endpoint financiero es solo admin y no se consume acá).
 */
export default function MetricasPage() {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [dashboard, setDashboard] = React.useState<OperationsDashboard | null>(null);
  const [metrics, setMetrics] = React.useState<DeliveryMetrics | null>(null);
  const [recon, setRecon] = React.useState<DayReconciliation | null>(null);
  const [range, setRange] = React.useState<"7d" | "30d" | "90d">("7d");
  const [closing, setClosing] = React.useState(false);

  const load = React.useCallback(
    async (silent = false) => {
      try {
        const to = new Date();
        const from = new Date(to);
        from.setDate(from.getDate() - RANGE_DAYS[range]);
        from.setUTCHours(0, 0, 0, 0);
        const [dashResult, metricResult, recResult] = await Promise.allSettled([
          api.get<OperationsDashboard>("/api/operations/dashboard"),
          api.get<DeliveryMetrics>(
            `/api/metrics/delivery?from=${from.toISOString()}&to=${to.toISOString()}`,
          ),
          api.get<DayReconciliation>("/api/operations/day-reconciliation"),
        ]);
        if (dashResult.status === "fulfilled") setDashboard(dashResult.value);
        if (metricResult.status === "fulfilled") setMetrics(metricResult.value);
        if (recResult.status === "fulfilled") setRecon(recResult.value);
        if (dashResult.status === "rejected" && metricResult.status === "rejected") {
          throw dashResult.reason;
        }
        setStatus("ready");
      } catch (err) {
        if (!silent) {
          setStatus("error");
          toast({
            title: "No se pudo cargar",
            description: err instanceof Error ? err.message : "Error de red",
            variant: "error",
          });
        }
      }
    },
    [range, toast],
  );

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const closeDay = React.useCallback(async () => {
    setClosing(true);
    try {
      const result = await api.post<DayReconciliation & { closed: boolean }>(
        "/api/operations/day-close",
        {},
      );
      setRecon(result);
      toast({
        title: result.closed ? "Día cerrado" : "La operación ya estaba cerrada",
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "No se pudo cerrar el día",
        description: err instanceof Error ? err.message : "Error de red",
        variant: "error",
      });
    } finally {
      setClosing(false);
    }
  }, [toast]);

  const exportCsv = React.useCallback(
    async (type: "packages" | "deliveries" | "incidents" | "operations") => {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - RANGE_DAYS[range]);
      from.setUTCHours(0, 0, 0, 0);
      const fromStr = from.toISOString();
      const toStr = to.toISOString();
      const url =
        `/api/export?type=${type}` +
        (type === "deliveries" || type === "incidents"
          ? `&from=${fromStr}&to=${toStr}`
          : "");
      try {
        const res = await fetch(url, { headers: { Accept: "text/csv" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = type;
        a.click();
        URL.revokeObjectURL(objectUrl);
      } catch (err) {
        toast({
          title: "No se pudo exportar",
          description: err instanceof Error ? err.message : "Error de red",
          variant: "error",
        });
      }
    },
    [range, toast],
  );

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Métricas"
          description="Dashboard operativo y cierre de día (FASE 12)"
        />
        <TableSkeleton columns={3} rows={5} />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Métricas"
          description="Dashboard operativo y cierre de día (FASE 12)"
        />
        <ErrorState onRetry={() => void load()} />
      </div>
    );
  }
  if (!dashboard || !metrics) return null;

  const totalPackages = dashboard.packagesByStatus.reduce((acc, s) => acc + s.count, 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Métricas"
        description="Dashboard operativo, métricas de reparto y cierre de día (§9.9)"
        action={
          <div className="flex items-center gap-2">
            <Select
              value={range}
              onChange={(e) => setRange(e.target.value as "7d" | "30d" | "90d")}
              className="w-28"
            >
              <option value="7d">Últimos 7 días</option>
              <option value="30d">Últimos 30 días</option>
              <option value="90d">Últimos 90 días</option>
            </Select>
            <Button size="sm" variant="outline" onClick={() => void load(true)}>
              Refrescar
            </Button>
          </div>
        }
      />

      {/* ── KPIs del día ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          icon={<Boxes className="size-4" />}
          label="Paquetes"
          value={String(totalPackages)}
          sub={`${dashboard.packagesByStatus.filter((s) => s.status === "ENTREGADO")[0]?.count ?? 0} entregados`}
        />
        <StatCard
          icon={<Route className="size-4" />}
          label="Rutas del día"
          value={String(dashboard.routesActive + dashboard.routesCompletedToday)}
          sub={`${dashboard.routesActive} activas · ${dashboard.routesCompletedToday} completadas`}
        />
        <StatCard
          icon={<Truck className="size-4" />}
          label="Choferes en ruta"
          value={String(dashboard.driversOnRoute)}
          sub={`${dashboard.driversOnline} online`}
        />
        <StatCard
          icon={<CheckCheck className="size-4" />}
          label="Entregas hoy"
          value={String(dashboard.deliveriesToday)}
          sub={
            dashboard.failuresToday > 0
              ? `${dashboard.failuresToday} fallas reportadas`
              : "sin fallas"
          }
        />
      </div>

      {/* ── Paquetes por estado ── */}
      <Card>
        <CardHeader>
          <CardTitle>Paquetes por estado</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {dashboard.packagesByStatus.length === 0 && (
              <p className="text-text-muted text-sm">Sin paquetes todavía.</p>
            )}
            {dashboard.packagesByStatus.map((s) => (
              <Badge key={s.status} variant="neutral">
                {PACKAGE_STATUS_LABELS[s.status] ?? s.status}: {s.count}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Métricas de reparto ── */}
      <Card>
        <CardHeader>
          <CardTitle>Métricas de reparto</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Entregas" value={String(metrics.deliveries)} />
            <StatCard label="Fallas" value={String(metrics.failures)} />
            <StatCard
              label="Tasa de éxito"
              value={`${(metrics.successRate * 100).toFixed(1)}%`}
            />
            <StatCard
              label="Paquetes/hora"
              value={
                metrics.packagesPerHour != null ? metrics.packagesPerHour.toFixed(1) : "—"
              }
            />
            <StatCard
              label="Km recorridos"
              value={metrics.totalKm != null ? String(metrics.totalKm) : "—"}
            />
            <StatCard
              label="Seg por entrega"
              value={
                metrics.avgSecondsPerDelivery != null
                  ? String(metrics.avgSecondsPerDelivery)
                  : "—"
              }
            />
            <StatCard label="Incidencias" value={String(metrics.incidents)} />
            <StatCard label="Reintentos" value={String(metrics.retries)} />
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-sm font-medium">Entregas por día</p>
              {metrics.deliveriesPerDay.length === 0 ? (
                <p className="text-text-muted text-sm">Sin datos en el rango.</p>
              ) : (
                <div className="flex items-end gap-1.5 overflow-x-auto">
                  {metrics.deliveriesPerDay.map((d) => {
                    const max = Math.max(
                      1,
                      ...metrics.deliveriesPerDay.map((x) => x.count),
                    );
                    return (
                      <div
                        key={d.day}
                        className="flex min-w-[28px] flex-col items-center gap-1"
                      >
                        <span className="text-xs">{d.count}</span>
                        <div
                          className="w-6 rounded-t bg-[var(--route-1)]"
                          style={{ height: `${Math.max(4, (d.count / max) * 64)}px` }}
                        />
                        <span className="text-text-muted text-[10px]">
                          {d.day.slice(5)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="min-w-[220px]">
              <p className="mb-2 text-sm font-medium">Por chofer</p>
              {metrics.deliveredByDriver.length === 0 ? (
                <p className="text-text-muted text-sm">Sin datos.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {metrics.deliveredByDriver.map((d) => (
                    <div
                      key={d.driverId || d.driverName}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="truncate">{d.driverName}</span>
                      <span className="text-text-muted">{d.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Cierre de día (§9.9) ── */}
      {recon && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4" />
              Cierre de día · {recon.date}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={recon.balanced ? "success" : "danger"}>
                {recon.balanced ? "Balanceado" : "Sin balancear"}
              </Badge>
              <Button
                size="sm"
                disabled={
                  !recon.balanced || recon.operationStatus === "CLOSED" || closing
                }
                onClick={() => void closeDay()}
              >
                {closing ? "Cerrando…" : "Cerrar día"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
              <span className="text-text-muted">
                Cargados: <span className="text-text font-medium">{recon.loaded}</span>
              </span>
              <span className="text-text-muted">
                Entregados:{" "}
                <span className="text-text font-medium">{recon.delivered}</span>
              </span>
              <span className="text-text-muted">
                Fallidos: <span className="text-text font-medium">{recon.failed}</span>
              </span>
              <span className="text-text-muted">
                Devueltos: <span className="text-text font-medium">{recon.returned}</span>
              </span>
              <span className="text-text-muted">
                Diferencia:{" "}
                <span
                  className={
                    recon.difference === 0
                      ? "text-status-success font-medium"
                      : "text-status-danger font-medium"
                  }
                >
                  {recon.difference}
                </span>
              </span>
            </div>
            {recon.suspicious.length > 0 && (
              <p className="text-text-muted text-xs">
                {recon.suspicious.length} paquete(s) en estado especial antes de cerrar:{" "}
                {recon.suspicious
                  .map((s) => `${s.internalCode} (${s.status})`)
                  .join(", ")}
              </p>
            )}
            {!recon.balanced && (
              <p className="text-status-danger text-xs">
                La ecuación CARGADOS = ENTREGADOS + FALLIDOS + DEVUELTOS + EN_DEPÓSITO no
                cierra.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Exportación CSV (§7) ── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Download className="size-4" />
            Exportación
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void exportCsv("packages")}>
            Paquetes
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void exportCsv("deliveries")}
          >
            Entregas
          </Button>
          <Button variant="outline" size="sm" onClick={() => void exportCsv("incidents")}>
            Incidencias
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void exportCsv("operations")}
          >
            Operaciones
          </Button>
        </CardContent>
      </Card>

      <p className="text-text-muted text-xs">
        Métricas económicas (rentabilidad por cliente) son solo para admin y requieren
        configurar tarifas (§20 #6).
      </p>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-4">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-text-muted text-xs font-medium">{label}</span>
        </div>
        <span className="font-data text-2xl">{value}</span>
        {sub && <span className="text-text-muted text-xs">{sub}</span>}
      </CardContent>
    </Card>
  );
}
