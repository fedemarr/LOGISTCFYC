"use client";

import * as React from "react";
import { CalendarDays, ImageOff } from "lucide-react";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { ErrorState, TableSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * MÉTRICAS (FYM):
 *  - Diaria: resumen por chofer del día (salió con N, entregó M, horas…).
 *  - Rango: global del período — paquetes entregados, horas promedio por
 *    turno, % de turnos sin incidentes y ranking de performance por chofer
 *    (pedido de Fede: "una [sección] tipo global de cuánto performance,
 *    tiempo de entrega, etc, es todo estadística").
 */

type Mode = "daily" | "range" | "deliveries";

interface DeliveryRow {
  id: string;
  orderNumber: string;
  customerName: string | null;
  shippingAddress: string | null;
  shippingCity: string | null;
  deliveredAt: string | null;
  recipientName: string | null;
  recipientDni: string | null;
  evidencePhotoUrl: string | null;
  driverName: string;
  shiftDate: string;
}

interface MetricRow {
  driver: { id: string; fullName: string };
  zoneName: string;
  shift: {
    status: "ACTIVE" | "ENDED";
    packageCount: number;
    undeliveredCount: number | null;
    startedAt: string;
    endedAt: string | null;
  };
  delivered: number;
  hoursWorkedHours: number;
  alertCountOpen: number;
  alertCountTotal: number;
}

interface RangeDriverRow {
  driver: { id: string; fullName: string };
  shiftsCount: number;
  totalPackages: number;
  delivered: number;
  undelivered: number;
  hoursWorkedHours: number;
  geoAlertCount: number;
  deliveryAlertCount: number;
  deliveredPerHour: number;
}

interface RangeData {
  from: string;
  to: string;
  summary: {
    totalShifts: number;
    endedShifts: number;
    activeShifts: number;
    totalPackages: number;
    totalDelivered: number;
    totalUndelivered: number;
    avgHoursPerShift: number;
    shiftsWithIncidents: number;
    pctShiftsWithoutIncidents: number;
  };
  drivers: RangeDriverRow[];
}

function fmtHours(h: number) {
  if (h <= 0) return "—";
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return `${hours}h ${mins.toString().padStart(2, "0")}m`;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-text-muted text-xs">{label}</p>
      <p className="font-data mt-1 text-xl">{value}</p>
    </Card>
  );
}

function todayStr() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

function firstOfMonthStr() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function MetricasPage() {
  const [mode, setMode] = React.useState<Mode>("range");

  // Diaria
  const [date, setDate] = React.useState(todayStr);
  const [rows, setRows] = React.useState<MetricRow[]>([]);
  const [loadingDaily, setLoadingDaily] = React.useState(true);
  const [errorDaily, setErrorDaily] = React.useState<Error | null>(null);

  // Rango
  const [from, setFrom] = React.useState(firstOfMonthStr);
  const [to, setTo] = React.useState(todayStr);
  const [range, setRange] = React.useState<RangeData | null>(null);
  const [loadingRange, setLoadingRange] = React.useState(true);
  const [errorRange, setErrorRange] = React.useState<Error | null>(null);

  // Entregas (pedido de Fede: "necesito saber a quién le entregó el
  // chofer, el DNI y el nombre, por si pasa algo después") — reusa el
  // mismo rango de fechas que "Rango".
  const [deliveries, setDeliveries] = React.useState<DeliveryRow[]>([]);
  const [loadingDeliveries, setLoadingDeliveries] = React.useState(true);
  const [errorDeliveries, setErrorDeliveries] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (mode !== "daily") return;
    let cancelled = false;
    api
      .get<{ rows: MetricRow[] }>(`/api/metricas?date=${date}`)
      .then((data) => {
        if (cancelled) return;
        setErrorDaily(null);
        setRows(data.rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorDaily(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoadingDaily(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, date]);

  React.useEffect(() => {
    if (mode !== "range") return;
    let cancelled = false;
    api
      .get<RangeData>(`/api/metricas?from=${from}&to=${to}`)
      .then((data) => {
        if (cancelled) return;
        setErrorRange(null);
        setRange(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorRange(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoadingRange(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, from, to]);

  React.useEffect(() => {
    if (mode !== "deliveries") return;
    let cancelled = false;
    api
      .get<{ deliveries: DeliveryRow[] }>(`/api/metricas/entregas?from=${from}&to=${to}`)
      .then((data) => {
        if (cancelled) return;
        setErrorDeliveries(null);
        setDeliveries(data.deliveries);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorDeliveries(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoadingDeliveries(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, from, to]);

  const summary = range?.summary;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Métricas"
        description={
          mode === "range"
            ? "Agregado del período: entregados, horas por turno, incidentes y ranking de choferes."
            : mode === "daily"
              ? "Cantidad de paquetes con la que salió cada chofer, qué entregó y qué dejó sin repartir."
              : "A quién le entregó cada pedido el chofer — nombre, DNI y foto de confirmación, por si hace falta después."
        }
        action={
          <div className="flex items-center gap-2">
            <div className="flex w-fit gap-1 rounded-lg border p-1">
              <Button
                size="sm"
                variant={mode === "range" ? "default" : "ghost"}
                onClick={() => setMode("range")}
              >
                Rango
              </Button>
              <Button
                size="sm"
                variant={mode === "daily" ? "default" : "ghost"}
                onClick={() => setMode("daily")}
              >
                Diaria
              </Button>
              <Button
                size="sm"
                variant={mode === "deliveries" ? "default" : "ghost"}
                onClick={() => setMode("deliveries")}
              >
                Entregas
              </Button>
            </div>
            {mode === "daily" ? (
              <div className="flex items-center gap-2">
                <CalendarDays className="text-text-muted size-4" />
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-44"
                  aria-label="Fecha de las métricas"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-40"
                  aria-label="Desde"
                />
                <span className="text-text-muted text-sm">→</span>
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-40"
                  aria-label="Hasta"
                />
              </div>
            )}
          </div>
        }
      />

      {mode === "range" && (
        <>
          {!loadingRange && !errorRange && summary && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <SummaryCard
                label="Entregados"
                value={summary.totalDelivered.toLocaleString("es-AR")}
              />
              <SummaryCard
                label="Paquetes en turnos"
                value={summary.totalPackages.toLocaleString("es-AR")}
              />
              <SummaryCard
                label="Turnos"
                value={summary.totalShifts.toLocaleString("es-AR")}
              />
              <SummaryCard
                label="Horas por turno"
                value={fmtHours(summary.avgHoursPerShift)}
              />
              <SummaryCard
                label="Turnos sin incidentes"
                value={`${summary.pctShiftsWithoutIncidents}%`}
              />
              <SummaryCard
                label="Sin repartir (rango)"
                value={summary.totalUndelivered.toLocaleString("es-AR")}
              />
            </div>
          )}

          <Card className="overflow-hidden">
            {loadingRange && !range && <TableSkeleton columns={9} rows={4} />}
            {errorRange && (
              <ErrorState
                title="No se pudieron cargar las métricas del rango"
                description={errorRange.message}
              />
            )}
            {!loadingRange && !errorRange && range && range.drivers.length === 0 && (
              <p className="text-text-muted p-6 text-sm">
                No hubo turnos en el período seleccionado.
              </p>
            )}
            {!loadingRange && range && range.drivers.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Chofer</TableHead>
                    <TableHead>Turnos</TableHead>
                    <TableHead>Paquetes</TableHead>
                    <TableHead>Entregados</TableHead>
                    <TableHead>Sin repartir</TableHead>
                    <TableHead>Horas</TableHead>
                    <TableHead>Entregados/h</TableHead>
                    <TableHead>Alertas geo</TableHead>
                    <TableHead>Alertas entrega</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {range.drivers.map((row) => (
                    <TableRow key={row.driver.id}>
                      <TableCell className="font-medium">{row.driver.fullName}</TableCell>
                      <TableCell className="text-text-muted">
                        {row.shiftsCount.toLocaleString("es-AR")}
                      </TableCell>
                      <TableCell>{row.totalPackages.toLocaleString("es-AR")}</TableCell>
                      <TableCell className="font-medium">
                        {row.delivered.toLocaleString("es-AR")}
                      </TableCell>
                      <TableCell className="text-text-muted">
                        {row.undelivered.toLocaleString("es-AR")}
                      </TableCell>
                      <TableCell className="text-text-muted">
                        {fmtHours(row.hoursWorkedHours)}
                      </TableCell>
                      <TableCell>
                        {row.deliveredPerHour > 0 ? (
                          <Badge variant="info">{row.deliveredPerHour} /h</Badge>
                        ) : (
                          <span className="text-text-muted text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-text-muted">
                        {row.geoAlertCount.toLocaleString("es-AR")}
                      </TableCell>
                      <TableCell className="text-text-muted">
                        {row.deliveryAlertCount.toLocaleString("es-AR")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}

      {mode === "daily" && (
        <Card className="overflow-hidden">
          {loadingDaily && <TableSkeleton columns={7} rows={4} />}
          {errorDaily && (
            <ErrorState
              title="No se pudieron cargar las métricas"
              description={errorDaily.message}
            />
          )}
          {!loadingDaily && !errorDaily && rows.length === 0 && (
            <p className="text-text-muted p-6 text-sm">No hubo turnos para esta fecha.</p>
          )}
          {!loadingDaily && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chofer</TableHead>
                  <TableHead>Zona</TableHead>
                  <TableHead>Salió con</TableHead>
                  <TableHead>Entregó</TableHead>
                  <TableHead>Sin repartir</TableHead>
                  <TableHead>Horas</TableHead>
                  <TableHead>Alertas</TableHead>
                  <TableHead>Turno</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.shift.startedAt + row.driver.id}>
                    <TableCell className="font-medium">{row.driver.fullName}</TableCell>
                    <TableCell className="text-text-muted">{row.zoneName}</TableCell>
                    <TableCell>{row.shift.packageCount}</TableCell>
                    <TableCell className="font-medium">{row.delivered}</TableCell>
                    <TableCell className="text-text-muted">
                      {row.shift.undeliveredCount ?? "—"}
                    </TableCell>
                    <TableCell className="text-text-muted">
                      {fmtHours(row.hoursWorkedHours)}
                    </TableCell>
                    <TableCell>
                      {row.alertCountTotal > 0 ? (
                        <Badge variant={row.alertCountOpen > 0 ? "neutral" : "success"}>
                          {row.alertCountOpen} de {row.alertCountTotal} abiertas
                        </Badge>
                      ) : (
                        <span className="text-text-muted text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={row.shift.status === "ACTIVE" ? "success" : "neutral"}
                      >
                        {row.shift.status === "ACTIVE" ? "en curso" : "cerrado"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {mode === "deliveries" && (
        <Card className="overflow-hidden">
          {loadingDeliveries && !deliveries.length && (
            <TableSkeleton columns={7} rows={4} />
          )}
          {errorDeliveries && (
            <ErrorState
              title="No se pudieron cargar las entregas"
              description={errorDeliveries.message}
            />
          )}
          {!loadingDeliveries && !errorDeliveries && deliveries.length === 0 && (
            <p className="text-text-muted p-6 text-sm">
              No hubo entregas en el período seleccionado.
            </p>
          )}
          {!loadingDeliveries && deliveries.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Chofer</TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Dirección</TableHead>
                  <TableHead>Recibió</TableHead>
                  <TableHead>DNI</TableHead>
                  <TableHead>Foto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-text-muted">
                      {d.deliveredAt
                        ? new Date(d.deliveredAt).toLocaleString("es-AR")
                        : d.shiftDate}
                    </TableCell>
                    <TableCell className="font-medium">{d.driverName}</TableCell>
                    <TableCell>
                      #{d.orderNumber}
                      <p className="text-text-muted text-xs">{d.customerName ?? "—"}</p>
                    </TableCell>
                    <TableCell className="text-text-muted">
                      {[d.shippingAddress, d.shippingCity].filter(Boolean).join(", ") ||
                        "—"}
                    </TableCell>
                    <TableCell className="font-medium">
                      {d.recipientName ?? "—"}
                    </TableCell>
                    <TableCell className="font-data">{d.recipientDni ?? "—"}</TableCell>
                    <TableCell>
                      {d.evidencePhotoUrl ? (
                        <a
                          href={d.evidencePhotoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary text-sm underline"
                        >
                          Ver foto
                        </a>
                      ) : (
                        <span className="text-text-muted flex items-center gap-1 text-xs">
                          <ImageOff className="size-3.5" /> sin foto
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
