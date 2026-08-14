"use client";

import * as React from "react";
import { History } from "lucide-react";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

interface TimelineEvent {
  eventId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorName: string | null;
  actorRole: string | null;
  lat: number | null;
  lng: number | null;
  occurredAt: string;
  recordedAt: string;
  metadata: Record<string, unknown>;
}

interface PackageTimeline {
  packageId: string;
  internalCode: string;
  trackingCode: string | null;
  currentStatus: string;
  events: TimelineEvent[];
}

const STATUS_LABELS: Record<string, string> = {
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

function eventLabel(type: string, from: string | null, to: string | null): string {
  if (type === "PACKAGE_STATUS_CHANGED") {
    return `${STATUS_LABELS[from ?? ""] ?? from ?? "?"} → ${STATUS_LABELS[to ?? ""] ?? to ?? "?"}`;
  }
  const pretty = type.replace(/_/g, " ").toLowerCase();
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

/**
 * Diálogo del timeline del paquete (FASE 12, criterio de aceptación #9):
 * la historia completa del bulto leída del event log append-only, en
 * orden cronológico. Botón "Ver timeline" en cada fila de /paquetes.
 */
export function PackageTimelineDialog({
  packageId,
  internalCode,
}: {
  packageId: string;
  internalCode: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [timeline, setTimeline] = React.useState<PackageTimeline | null>(null);

  const load = React.useCallback(async () => {
    if (timeline) return;
    try {
      const data = await api.get<PackageTimeline>(`/api/packages/${packageId}/timeline`);
      setTimeline(data);
    } catch (err) {
      toast({
        title: "No se pudo cargar el timeline",
        description: err instanceof Error ? err.message : "Error de red",
        variant: "error",
      });
    }
  }, [packageId, timeline, toast]);

  return (
    <DialogRoot
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) void load();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            Timeline
          </Button>
        }
      >
        <History className="size-3.5" />
        Timeline
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto">
        <DialogTitle>Timeline · {internalCode}</DialogTitle>
        <DialogDescription>
          Historia completa del bulto desde el event log (append-only).
        </DialogDescription>

        {!timeline ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : timeline.events.length === 0 ? (
          <p className="text-text-muted py-6 text-center text-sm">
            Sin eventos registrados todavía.
          </p>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            {timeline.events.map((ev, i) => (
              <div key={ev.eventId} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`size-2.5 rounded-full ${
                      i === timeline.events.length - 1
                        ? "bg-status-success"
                        : "bg-text-muted/50"
                    }`}
                  />
                  {i < timeline.events.length - 1 && (
                    <div className="bg-border w-px flex-1" />
                  )}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium">
                      {eventLabel(ev.eventType, ev.fromStatus, ev.toStatus)}
                    </span>
                    <span className="text-text-muted text-xs">
                      {fmtDateTime(ev.occurredAt)}
                    </span>
                  </div>
                  <div className="text-text-muted mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                    {ev.actorName && <span>{ev.actorName}</span>}
                    {ev.actorRole && (
                      <span className="bg-muted rounded px-1 py-px">{ev.actorRole}</span>
                    )}
                    {ev.lat != null && ev.lng != null && (
                      <span>
                        {ev.lat.toFixed(5)}, {ev.lng.toFixed(5)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </DialogRoot>
  );
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
