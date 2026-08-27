"use client";

import * as React from "react";
import { Check, Phone } from "lucide-react";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { ErrorState, TableSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

/**
 * ALERTAS (FYM) — cola de alertas de geocerca. El admin llama al chofer desde
 * acá (había que tener su teléfono a mano — pedido de Fede).
 */

interface AlertItem {
  id: string;
  alertType: string;
  status: "OPEN" | "RESOLVED";
  distanceOutsideM: number | null;
  triggeredAt: string;
  resolvedAt: string | null;
  shift: { id: string; packageCount: number };
  driver: { id: string; fullName: string; phone: string | null };
  zone: { id: string; name: string; colorHex: string };
}

export default function AlertasPage() {
  const { toast } = useToast();
  const [alerts, setAlerts] = React.useState<AlertItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);
  const [resolvingId, setResolvingId] = React.useState<string | null>(null);

  async function load() {
    try {
      const data = await api.get<{ alerts: AlertItem[] }>("/api/alerts?status=OPEN");
      setError(null);
      setAlerts(data.alerts);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ alerts: AlertItem[] }>("/api/alerts?status=OPEN")
      .then((data) => {
        if (cancelled) return;
        setError(null);
        setAlerts(data.alerts);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleResolve(alert: AlertItem) {
    setResolvingId(alert.id);
    try {
      await api.patch(`/api/alerts/${alert.id}`, {});
      toast({ title: "Alerta resuelta", variant: "success" });
      await load();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo resolver",
        variant: "error",
      });
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Alertas"
        description="Choferes que salieron del radio de su zona con turno activo. Llamalos para saber qué pasó."
        action={
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Recargar
          </Button>
        }
      />

      <Card className="overflow-hidden">
        {loading && !alerts.length && <TableSkeleton columns={5} rows={4} />}
        {error && (
          <ErrorState
            title="No se pudieron cargar las alertas"
            description={error.message}
            onRetry={() => void load()}
          />
        )}
        {!loading && !error && alerts.length === 0 && (
          <p className="text-text-muted p-6 text-sm">
            No hay alertas abiertas. Todos los choferes con turno activo están dentro de
            su zona.
          </p>
        )}
        {alerts.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Zona</TableHead>
                <TableHead>Chofer</TableHead>
                <TableHead>Distancia afuera</TableHead>
                <TableHead>Hora</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((alert) => (
                <TableRow key={alert.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className="size-3 rounded-full"
                        style={{ backgroundColor: alert.zone.colorHex }}
                      />
                      <span className="text-sm font-medium">{alert.zone.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{alert.driver.fullName}</div>
                    <div className="text-text-muted text-xs">
                      {alert.driver.phone ?? "sin teléfono"}
                    </div>
                  </TableCell>
                  <TableCell className="text-text-muted text-sm">
                    {alert.distanceOutsideM != null
                      ? `${alert.distanceOutsideM.toLocaleString("es-AR")} m`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-text-muted text-sm">
                    {new Date(alert.triggeredAt).toLocaleTimeString("es-AR")}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {alert.driver.phone && (
                        <Button
                          variant="outline"
                          size="sm"
                          render={<a href={`tel:${alert.driver.phone}`} />}
                        >
                          <Phone />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={resolvingId === alert.id}
                        onClick={() => void handleResolve(alert)}
                      >
                        <Check /> Resolver
                      </Button>
                    </div>
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
