"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { ErrorState, TableSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
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
 * MÉTRICAS (FYM) — resumen diario por chofer: salió con N paquetes, entregó
 * M (último aviso), dejó X sin repartir, horas trabajadas y alertas de zona.
 */

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

function fmtHours(h: number) {
  if (h <= 0) return "—";
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return `${hours}h ${mins.toString().padStart(2, "0")}m`;
}

export default function MetricasPage() {
  const [date, setDate] = React.useState(() =>
    new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
    }),
  );
  const [rows, setRows] = React.useState<MetricRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ rows: MetricRow[] }>(`/api/metricas?date=${date}`)
      .then((data) => {
        if (!cancelled) {
          setError(null);
          setRows(data.rows);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Métricas diarias"
        description="Cantidad de paquetes con la que salió cada chofer, qué entregó y qué dejó sin repartir."
        action={
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
        }
      />

      <Card className="overflow-hidden">
        {loading && <TableSkeleton columns={7} rows={4} />}
        {error && (
          <ErrorState
            title="No se pudieron cargar las métricas"
            description={error.message}
          />
        )}
        {!loading && !error && rows.length === 0 && (
          <p className="text-text-muted p-6 text-sm">No hubo turnos para esta fecha.</p>
        )}
        {!loading && rows.length > 0 && (
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
    </div>
  );
}
