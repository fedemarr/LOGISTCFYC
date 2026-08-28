"use client";

import * as React from "react";
import { Check, Phone, UserRoundSearch } from "lucide-react";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { ErrorState, TableSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
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
 * ALERTAS (FYM) — dos colas:
 *  - Geocerca: choferes que salieron del radio de su zona con turno activo.
 *  - Entrega: problemas de entrega reportados por el chofer desde la PWA
 *    (no estaba el destinatario / rechazó / otro) con el teléfono de
 *    contacto para que control llame al destinatario sin frenar al chofer.
 */

type Tab = "geocerca" | "entrega";

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

interface DeliveryAlertItem {
  id: string;
  reason: "NOT_HOME" | "REFUSED" | "OTHER";
  contactPhone: string | null;
  note: string | null;
  status: "OPEN" | "CONTACTED" | "RESOLVED";
  createdAt: string;
  resolvedAt: string | null;
  shift: { id: string; status: string; packageCount: number };
  zone: { id: string; name: string; colorHex: string };
  driver: { id: string; fullName: string; phone: string | null };
}

const REASON_LABEL: Record<DeliveryAlertItem["reason"], string> = {
  NOT_HOME: "No estaba el destinatario",
  REFUSED: "Rechazó el paquete",
  OTHER: "Otro",
};

const DELIVERY_STATUS_LABEL: Record<DeliveryAlertItem["status"], string> = {
  OPEN: "abierta",
  CONTACTED: "contactado",
  RESOLVED: "resuelta",
};

export default function AlertasPage() {
  const { toast } = useToast();
  const [tab, setTab] = React.useState<Tab>("geocerca");

  // Geocerca
  const [alerts, setAlerts] = React.useState<AlertItem[]>([]);
  const [loadingGeo, setLoadingGeo] = React.useState(true);
  const [errorGeo, setErrorGeo] = React.useState<Error | null>(null);
  const [resolvingId, setResolvingId] = React.useState<string | null>(null);

  // Entrega
  const [deliveryAlerts, setDeliveryAlerts] = React.useState<DeliveryAlertItem[]>([]);
  const [loadingDelivery, setLoadingDelivery] = React.useState(true);
  const [errorDelivery, setErrorDelivery] = React.useState<Error | null>(null);
  const [markingId, setMarkingId] = React.useState<string | null>(null);

  async function loadGeo() {
    try {
      const data = await api.get<{ alerts: AlertItem[] }>("/api/alerts?status=OPEN");
      setErrorGeo(null);
      setAlerts(data.alerts);
    } catch (err) {
      setErrorGeo(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoadingGeo(false);
    }
  }

  async function loadDelivery() {
    try {
      const data = await api.get<{ alerts: DeliveryAlertItem[] }>("/api/delivery-alerts");
      setErrorDelivery(null);
      setDeliveryAlerts(data.alerts);
    } catch (err) {
      setErrorDelivery(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoadingDelivery(false);
    }
  }

  React.useEffect(() => {
    if (tab !== "geocerca") return;
    let cancelled = false;
    api
      .get<{ alerts: AlertItem[] }>("/api/alerts?status=OPEN")
      .then((data) => {
        if (cancelled) return;
        setErrorGeo(null);
        setAlerts(data.alerts);
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorGeo(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoadingGeo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  React.useEffect(() => {
    if (tab !== "entrega") return;
    let cancelled = false;
    api
      .get<{ alerts: DeliveryAlertItem[] }>("/api/delivery-alerts")
      .then((data) => {
        if (cancelled) return;
        setErrorDelivery(null);
        setDeliveryAlerts(data.alerts);
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorDelivery(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoadingDelivery(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  async function handleResolve(alert: AlertItem) {
    setResolvingId(alert.id);
    try {
      await api.patch(`/api/alerts/${alert.id}`, {});
      toast({ title: "Alerta resuelta", variant: "success" });
      await loadGeo();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo resolver",
        variant: "error",
      });
    } finally {
      setResolvingId(null);
    }
  }

  async function handleMarkDelivery(
    alert: DeliveryAlertItem,
    status: "CONTACTED" | "RESOLVED",
  ) {
    setMarkingId(alert.id);
    try {
      await api.patch(`/api/delivery-alerts/${alert.id}`, { status });
      toast({
        title: status === "CONTACTED" ? "Marcada como contactado" : "Alerta resuelta",
        variant: "success",
      });
      await loadDelivery();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo actualizar",
        variant: "error",
      });
    } finally {
      setMarkingId(null);
    }
  }

  const reload = () => {
    if (tab === "geocerca") void loadGeo();
    else void loadDelivery();
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Alertas"
        description="Choferes fuera de su zona y problemas de entrega reportados desde la PWA."
        action={
          <Button variant="outline" size="sm" onClick={reload}>
            Recargar
          </Button>
        }
      />

      <div className="flex w-fit gap-1 rounded-lg border p-1">
        <Button
          size="sm"
          variant={tab === "geocerca" ? "default" : "ghost"}
          onClick={() => setTab("geocerca")}
        >
          Geocerca
        </Button>
        <Button
          size="sm"
          variant={tab === "entrega" ? "default" : "ghost"}
          onClick={() => setTab("entrega")}
        >
          Entrega
        </Button>
      </div>

      {tab === "geocerca" && (
        <Card className="overflow-hidden">
          {loadingGeo && !alerts.length && <TableSkeleton columns={5} rows={4} />}
          {errorGeo && (
            <ErrorState
              title="No se pudieron cargar las alertas"
              description={errorGeo.message}
              onRetry={() => void loadGeo()}
            />
          )}
          {!loadingGeo && !errorGeo && alerts.length === 0 && (
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
      )}

      {tab === "entrega" && (
        <Card className="overflow-hidden">
          {loadingDelivery && !deliveryAlerts.length && (
            <TableSkeleton columns={5} rows={4} />
          )}
          {errorDelivery && (
            <ErrorState
              title="No se pudieron cargar las alertas de entrega"
              description={errorDelivery.message}
              onRetry={() => void loadDelivery()}
            />
          )}
          {!loadingDelivery && !errorDelivery && deliveryAlerts.length === 0 && (
            <p className="text-text-muted p-6 text-sm">
              No hay problemas de entrega reportados. Cuando un chofer cargue uno desde la
              PWA, aparece acá con el teléfono para llamar.
            </p>
          )}
          {deliveryAlerts.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chofer</TableHead>
                  <TableHead>Zona</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Nota</TableHead>
                  <TableHead>Hora</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveryAlerts.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <div className="text-sm font-medium">{alert.driver.fullName}</div>
                      <div className="text-text-muted text-xs">
                        {alert.driver.phone ?? "sin teléfono"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="size-3 rounded-full"
                          style={{ backgroundColor: alert.zone.colorHex }}
                        />
                        <span className="text-sm">{alert.zone.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {REASON_LABEL[alert.reason]}
                    </TableCell>
                    <TableCell>
                      {alert.contactPhone ? (
                        <span className="font-medium">{alert.contactPhone}</span>
                      ) : (
                        <span className="text-text-muted text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-text-muted text-sm">
                      <span className="line-clamp-1">{alert.note ?? "—"}</span>
                    </TableCell>
                    <TableCell className="text-text-muted text-sm">
                      {new Date(alert.createdAt).toLocaleString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          alert.status === "RESOLVED"
                            ? "success"
                            : alert.status === "CONTACTED"
                              ? "neutral"
                              : "warning"
                        }
                      >
                        {DELIVERY_STATUS_LABEL[alert.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {alert.contactPhone && (
                          <Button
                            variant="outline"
                            size="sm"
                            render={<a href={`tel:${alert.contactPhone}`} />}
                          >
                            <Phone />
                          </Button>
                        )}
                        {alert.status === "OPEN" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={markingId === alert.id}
                            onClick={() => void handleMarkDelivery(alert, "CONTACTED")}
                          >
                            <UserRoundSearch /> Contactado
                          </Button>
                        )}
                        {alert.status !== "RESOLVED" && (
                          <Button
                            size="sm"
                            disabled={markingId === alert.id}
                            onClick={() => void handleMarkDelivery(alert, "RESOLVED")}
                          >
                            <Check /> Resolver
                          </Button>
                        )}
                      </div>
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
