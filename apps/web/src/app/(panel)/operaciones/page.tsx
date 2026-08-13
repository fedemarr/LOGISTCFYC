"use client";

import * as React from "react";
import { AlertTriangle, PackageX, Truck } from "lucide-react";
import { api, type DispatchInbox } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";

const INCIDENT_REASON_LABELS: Record<string, string> = {
  NO_ONE_HOME: "No hay nadie",
  NO_ANSWER: "No atiende",
  WRONG_ADDRESS: "Dirección errónea",
  NONEXISTENT_ADDRESS: "Dirección inexistente",
  REFUSED: "Rechaza el paquete",
  NO_ACCESS: "Sin acceso",
  UNSAFE_AREA: "Zona insegura",
  VEHICLE_ISSUE: "Problema del vehículo",
  DAMAGED: "Bulto dañado",
  MISSING_BULK: "Bulto faltante",
  OTHER: "Otro",
};

const POLL_MS = 30_000;

/**
 * `/operaciones` — bandeja de excepciones del dispatcher (FASE 11, la
 * pantalla principal del rol): incidentes de la calle con SLA corriendo,
 * entregas que se registraron a más de 150 m del domicilio (anti-fraude
 * §9.5, a revisar) y actas de custodia en diferencia sin resolver.
 * Polling cada 30 s contra `/api/operations/inbox`.
 */
export default function OperacionesPage() {
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [inbox, setInbox] = React.useState<DispatchInbox | null>(null);

  const load = React.useCallback(async (silent = false) => {
    try {
      const data = await api.get<DispatchInbox>("/api/operations/inbox");
      setInbox(data);
      setStatus("ready");
    } catch {
      if (!silent) setStatus("error");
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) return;
    })();
    const poll = setInterval(() => void load(true), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [load]);

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Operaciones"
          description="Bandeja de excepciones del dispatcher (§10)"
        />
        <TableSkeleton columns={3} rows={5} />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Operaciones"
          description="Bandeja de excepciones del dispatcher (§10)"
        />
        <ErrorState onRetry={() => void load()} />
      </div>
    );
  }
  if (!inbox) return null;

  const total =
    inbox.incidents.length +
    inbox.reviewDeliveries.length +
    inbox.custodyDiscrepancies.length;
  const openIncidents = inbox.incidents.filter((i) => i.slaOverdueS != null);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Operaciones"
        description={`${total} excepción(es) sin resolver · polling cada ${POLL_MS / 1000} s`}
        action={
          total > 0 ? (
            <Badge variant={openIncidents.length > 0 ? "danger" : "neutral"}>
              <AlertTriangle className="size-3.5" />
              {openIncidents.length} con SLA vencido
            </Badge>
          ) : undefined
        }
      />

      {/* ── Incidentes de la calle ── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <PackageX className="size-4" />
            Incidentes
          </CardTitle>
          <Badge variant="neutral">{inbox.incidents.length}</Badge>
        </CardHeader>
        <CardContent>
          {inbox.incidents.length === 0 ? (
            <p className="text-text-muted py-4 text-sm">Sin incidentes abiertos.</p>
          ) : (
            <div className="flex flex-col divide-y">
              {inbox.incidents.map((inc) => (
                <div
                  key={inc.incidentId}
                  className="flex flex-wrap items-center gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {inc.slaOverdueS != null && (
                        <Badge variant="danger">
                          SLA vencido {fmtMin(inc.slaOverdueS)}
                        </Badge>
                      )}
                      <span className="font-mono text-sm">
                        {inc.internalCode ?? "—"} · Ruta{" "}
                        {inc.routeNumber != null
                          ? String(inc.routeNumber).padStart(3, "0")
                          : "—"}
                      </span>
                    </div>
                    <p className="text-sm">
                      {INCIDENT_REASON_LABELS[inc.reason] ?? inc.reason}
                    </p>
                    {inc.description && (
                      <p className="text-text-muted text-sm">{inc.description}</p>
                    )}
                    <p className="text-text-muted text-xs">
                      {inc.driverName ?? "Sin chofer"} · {fmtDateTime(inc.createdAt)}
                    </p>
                  </div>
                  {inc.photoUrls.length > 0 && (
                    <a
                      href={inc.photoUrls[0]}
                      target="_blank"
                      rel="noreferrer"
                      className="text-text-muted text-xs underline"
                    >
                      foto evidencia
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Entregas a revisar (anti-fraude §9.5) ── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4" />
            Entregas a revisar
          </CardTitle>
          <Badge variant={inbox.reviewDeliveries.length > 0 ? "warning" : "neutral"}>
            {inbox.reviewDeliveries.length}
          </Badge>
        </CardHeader>
        <CardContent>
          {inbox.reviewDeliveries.length === 0 ? (
            <p className="text-text-muted py-4 text-sm">
              Todas las entregas están dentro del radio.
            </p>
          ) : (
            <div className="flex flex-col divide-y">
              {inbox.reviewDeliveries.map((d) => (
                <div
                  key={d.deliveryId}
                  className="flex flex-wrap items-center gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="warning">
                        a{" "}
                        {d.distanceFromTargetM != null
                          ? `${d.distanceFromTargetM} m`
                          : "—"}{" "}
                        del domicilio
                      </Badge>
                      <span className="font-mono text-sm">
                        {d.internalCode ?? "—"} · Ruta{" "}
                        {d.routeNumber != null
                          ? String(d.routeNumber).padStart(3, "0")
                          : "—"}
                      </span>
                    </div>
                    <p className="text-sm">Recibió: {d.receiverName ?? "sin nombre"}</p>
                    <p className="text-text-muted text-xs">
                      {d.driverName ?? "Sin chofer"} · {fmtDateTime(d.deliveredAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Discrepancias de custodia ── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Truck className="size-4" />
            Custodia en diferencia
          </CardTitle>
          <Badge variant={inbox.custodyDiscrepancies.length > 0 ? "warning" : "neutral"}>
            {inbox.custodyDiscrepancies.length}
          </Badge>
        </CardHeader>
        <CardContent>
          {inbox.custodyDiscrepancies.length === 0 ? (
            <p className="text-text-muted py-4 text-sm">
              Ninguna acta de custodia en diferencia.
            </p>
          ) : (
            <div className="flex flex-col divide-y">
              {inbox.custodyDiscrepancies.map((c) => (
                <div key={c.custodyId} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="warning">chequeo cruzado pendiente</Badge>
                      <span className="font-mono text-sm">
                        Ruta{" "}
                        {c.routeNumber != null
                          ? String(c.routeNumber).padStart(3, "0")
                          : "—"}
                      </span>
                    </div>
                    <p className="text-sm">
                      Esperado {c.expectedCount} · contado {c.countedCount ?? "—"} (
                      {c.method})
                    </p>
                    {c.discrepancyNotes && (
                      <p className="text-text-muted text-sm">{c.discrepancyNotes}</p>
                    )}
                    <p className="text-text-muted text-xs">
                      {c.driverName ?? "Sin chofer"} · {fmtDateTime(c.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {total === 0 && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              title="Bandeja al día"
              description="No hay incidentes, entregas a revisar ni discrepancias de custodia pendientes."
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function fmtMin(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60));
  return `hace ${min} min`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} · ${hh}:${min}`;
}
