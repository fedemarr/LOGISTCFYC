"use client";

import * as React from "react";
import { RotateCcw, Send, Truck, Undo2, XCircle } from "lucide-react";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

export type IncidentResolution =
  "RETRY_NOW" | "RESCHEDULE" | "RETURN" | "DELIVER_ANYWAY" | "CANCEL";

interface ResolveIncidentDialogProps {
  incidentId: string;
  internalCode: string;
  onResolved: () => void;
}

const RESOLUTIONS: {
  value: IncidentResolution;
  label: string;
  description: string;
  needsNote?: boolean;
}[] = [
  {
    value: "RETRY_NOW",
    label: "Reintentar hoy",
    description: "El paquete vuelve al reparto de hoy (parada PENDING).",
  },
  {
    value: "RESCHEDULE",
    label: "Reprogramar",
    description: "El paquete queda reprogramado para otro día.",
  },
  {
    value: "RETURN",
    label: "Devolver al depósito",
    description: "El paquete vuelve al depósito de la organización.",
  },
  {
    value: "DELIVER_ANYWAY",
    label: "Entregar igual",
    description: "Confirma la entrega con la evidencia del chofer (requiere foto).",
  },
  {
    value: "CANCEL",
    label: "Cancelar",
    description: "Anula el paquete (requiere motivo).",
    needsNote: true,
  },
];

/**
 * Diálogo de resolución de incidencias (§9.7): el dispatcher decide entre
 * las 5 opciones legales de la máquina de estados y, en las que lo
 * requieren, deja una nota. POST a /api/incidents/:id/resolve.
 */
export function ResolveIncidentDialog({
  incidentId,
  internalCode,
  onResolved,
}: ResolveIncidentDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [resolution, setResolution] = React.useState<IncidentResolution | null>(null);
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const reset = React.useCallback(() => {
    setResolution(null);
    setNote("");
    setSubmitting(false);
  }, []);

  const submit = React.useCallback(async () => {
    if (!resolution) return;
    setSubmitting(true);
    try {
      await api.post(`/api/incidents/${incidentId}/resolve`, {
        resolution,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast({ title: "Incidencia resuelta", variant: "success" });
      setOpen(false);
      reset();
      onResolved();
    } catch (err) {
      toast({
        title: "No se pudo resolver",
        description: err instanceof Error ? err.message : "Error de red",
        variant: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }, [resolution, note, incidentId, toast, reset, onResolved]);

  const selectedNeedsNote = RESOLUTIONS.find((r) => r.value === resolution)?.needsNote;

  return (
    <DialogRoot
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Resolver
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogTitle>Resolver incidencia · {internalCode}</DialogTitle>
        <DialogDescription>
          Decidí la resolución de la falla reportada. El paquete cambia de estado según lo
          elegido (el chofer recibe la notificación).
        </DialogDescription>

        <div className="flex flex-col gap-1.5">
          {RESOLUTIONS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setResolution(r.value)}
              className={cn(
                "flex items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors",
                resolution === r.value ? "border-primary bg-primary/5" : "hover:bg-muted",
              )}
            >
              <span className="mt-0.5 shrink-0">
                {r.value === "RETRY_NOW" && <RotateCcw className="size-4" />}
                {r.value === "RESCHEDULE" && <Undo2 className="size-4" />}
                {r.value === "RETURN" && <Truck className="size-4" />}
                {r.value === "DELIVER_ANYWAY" && <Send className="size-4" />}
                {r.value === "CANCEL" && <XCircle className="size-4" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{r.label}</span>
                <span className="text-text-muted block text-xs">{r.description}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="resolve-note">Nota (opcional)</Label>
          <Textarea
            id="resolve-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              selectedNeedsNote
                ? "Motivo obligatorio para cancelar"
                : "Detalle de la decisión…"
            }
            rows={2}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={!resolution || submitting || (!!selectedNeedsNote && !note.trim())}
            onClick={() => void submit()}
          >
            {submitting ? "Resolviendo…" : "Confirmar"}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
