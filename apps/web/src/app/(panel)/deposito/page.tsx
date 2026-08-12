"use client";

import * as React from "react";
import { CheckCircle2, PackageSearch, ScanLine, Upload } from "lucide-react";
import {
  api,
  type CloseOperationResponse,
  type GeocodeSummary,
  type ImportSummary,
  type OperationItem,
  type Page,
  type PendingPackageItem,
  type ScanOutcomeResponse,
} from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, TableSkeleton } from "@/components/states";
import { useToast } from "@/components/ui/toast";

/**
 * `/deposito` — operación del día: importar manifiesto, escanear, resolver
 * direcciones, geocodificar y cerrar (§9.1). FASE 5: funcional pero sin el
 * pulido visual del mockup todavía — eso se aplica en el rediseño de
 * PROMPT-FRONTEND-V2 sobre estas mismas pantallas.
 */
export default function DepositoPage() {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [operation, setOperation] = React.useState<OperationItem | null>(null);
  const [pending, setPending] = React.useState<PendingPackageItem[] | null>(null);

  const loadOperation = React.useCallback(async () => {
    try {
      const page = await api.get<Page<OperationItem>>(
        "/api/operations?status=OPEN&pageSize=1",
      );
      setOperation(page.items[0] ?? null);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadOperation();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOperation]);

  const loadPending = React.useCallback(async (operationId: string) => {
    try {
      const result = await api.get<{ items: PendingPackageItem[] }>(
        `/api/operations/${operationId}/pending`,
      );
      setPending(result.items);
    } catch {
      // no bloquea el resto de la pantalla — se puede reintentar
    }
  }, []);

  React.useEffect(() => {
    if (!operation) return;
    let cancelled = false;
    void (async () => {
      await loadPending(operation.id);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [operation, loadPending]);

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Depósito" description="Operación del día" />
        <TableSkeleton columns={2} rows={4} />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Depósito" description="Operación del día" />
        <ErrorState onRetry={loadOperation} />
      </div>
    );
  }

  if (!operation) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Depósito" description="Operación del día" />
        <CreateOperationCard
          onCreated={(op) => {
            setOperation(op);
            toast({ title: `Operación ${op.operationDate} creada`, variant: "success" });
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Depósito"
        description={`Operación ${operation.operationDate} · ${operation.status === "OPEN" ? "abierta" : "cerrada"}`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Esperados" value={operation.expectedCount} />
        <Stat label="Recibidos" value={operation.receivedCount} />
        <Stat
          label="Sin resolver"
          value={pending?.length ?? "…"}
          warn={(pending?.length ?? 0) > 0}
        />
      </div>

      {operation.status === "OPEN" && (
        <>
          <ImportCard
            operationId={operation.id}
            onImported={() => {
              void loadOperation();
              void loadPending(operation.id);
            }}
          />
          <ScanCard
            operationId={operation.id}
            onScanned={() => {
              void loadOperation();
              void loadPending(operation.id);
            }}
          />
          <PendingCard
            items={pending}
            onResolved={() => {
              void loadOperation();
              void loadPending(operation.id);
            }}
          />
          <ActionsCard operation={operation} onChanged={loadOperation} />
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: number | string;
  warn?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className={`text-2xl font-semibold ${warn ? "text-status-warning" : ""}`}>
          {value}
        </div>
        <div className="text-text-muted text-xs uppercase tracking-wide">{label}</div>
      </CardContent>
    </Card>
  );
}

function CreateOperationCard({ onCreated }: { onCreated: (op: OperationItem) => void }) {
  const { toast } = useToast();
  const [date, setDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = React.useState(false);

  async function handleCreate() {
    setBusy(true);
    try {
      const op = await api.post<OperationItem>("/api/operations", {
        operationDate: date,
      });
      onCreated(op);
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo crear la operación",
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>No hay una operación abierta</CardTitle>
      </CardHeader>
      <CardContent className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-date">Fecha</Label>
          <Input
            id="op-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <Button onClick={() => void handleCreate()} disabled={busy}>
          Crear operación
        </Button>
      </CardContent>
    </Card>
  );
}

function ImportCard({
  operationId,
  onImported,
}: {
  operationId: string;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const [raw, setRaw] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function handleImport() {
    const rows = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [trackingCode, recipientName, recipientPhone, address] = line
          .split(",")
          .map((c) => c.trim());
        return { trackingCode, recipientName, recipientPhone, address };
      })
      .filter((r) => r.trackingCode);

    if (rows.length === 0) {
      toast({
        title: "Pegá al menos una fila (código,destinatario,teléfono,dirección)",
        variant: "error",
      });
      return;
    }

    setBusy(true);
    try {
      const summary = await api.post<ImportSummary>(
        `/api/operations/${operationId}/import`,
        {
          rows,
        },
      );
      toast({
        title: `${summary.created} paquetes importados${summary.skipped ? ` (${summary.skipped} ya existían)` : ""}`,
        variant: "success",
      });
      setRaw("");
      onImported();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo importar",
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="size-4" /> Importar manifiesto
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-text-muted text-sm">
          Una fila por paquete: <code>código,destinatario,teléfono,dirección</code> (los
          últimos tres son opcionales).
        </p>
        <Textarea
          rows={5}
          placeholder={
            "ML-4471801,Juan Pérez,1122334455,Av. San Martín 1234 Villa Ballester"
          }
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
        <div>
          <Button onClick={() => void handleImport()} disabled={busy}>
            Importar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ScanCard({
  operationId,
  onScanned,
}: {
  operationId: string;
  onScanned: () => void;
}) {
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<ScanOutcomeResponse | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const outcome = await api.post<ScanOutcomeResponse>(
        `/api/operations/${operationId}/scan`,
        {
          rawCode: code.trim(),
        },
      );
      setLastResult(outcome);
      onScanned();
    } catch {
      setLastResult(null);
    } finally {
      setCode("");
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScanLine className="size-4" /> Escanear
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={(e) => void handleScan(e)} className="flex gap-2">
          <Input
            ref={inputRef}
            autoFocus
            placeholder="Código escaneado"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={busy}
          />
          <Button type="submit" disabled={busy}>
            Escanear
          </Button>
        </form>
        {lastResult && (
          <div className="bg-muted flex items-center gap-2 rounded-md p-3 text-sm">
            {lastResult.duplicate ? (
              <Badge variant="warning">Ya escaneado</Badge>
            ) : lastResult.resolution.resolved ? (
              <Badge variant="success">
                <CheckCircle2 className="size-3" /> Resuelto (
                {lastResult.resolution.source})
              </Badge>
            ) : (
              <Badge variant="neutral">A la bandeja de resolución</Badge>
            )}
            {lastResult.wrongClient && <Badge variant="danger">Cliente equivocado</Badge>}
            <span className="text-text-muted">{lastResult.internalCode}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PendingCard({
  items,
  onResolved,
}: {
  items: PendingPackageItem[] | null;
  onResolved: () => void;
}) {
  const { toast } = useToast();
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [busyAll, setBusyAll] = React.useState(false);

  // Si el manifiesto ya trajo la dirección (import con columna de
  // dirección), precargamos el input con eso — el humano solo tiene que
  // confirmar que el paquete llegó físicamente, no retipear nada.
  React.useEffect(() => {
    if (!items) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const pkg of items) {
        if (next[pkg.id] === undefined && pkg.rawAddressText) {
          next[pkg.id] = pkg.rawAddressText;
        }
      }
      return next;
    });
  }, [items]);

  async function resolveOne(id: string, rawAddressText: string) {
    await api.post(`/api/packages/${id}/resolve`, { rawAddressText });
  }

  async function handleResolve(id: string) {
    const rawAddressText = drafts[id]?.trim();
    if (!rawAddressText || rawAddressText.length < 3) {
      toast({ title: "Escribí una dirección válida", variant: "error" });
      return;
    }
    setBusyId(id);
    try {
      await resolveOne(id, rawAddressText);
      toast({ title: "Dirección resuelta", variant: "success" });
      onResolved();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo resolver",
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  // Resuelve de una todos los que ya tienen dirección cargada (del
  // manifiesto o ya tipeada a mano) — pensado para el caso "importé un
  // CSV con todo adentro, no quiero tocar uno por uno".
  const readyToResolve = (items ?? []).filter(
    (pkg) => (drafts[pkg.id]?.trim().length ?? 0) >= 3,
  );

  async function handleResolveAll() {
    setBusyAll(true);
    let ok = 0;
    let failed = 0;
    for (const pkg of readyToResolve) {
      const rawAddressText = drafts[pkg.id]!.trim();
      try {
        await resolveOne(pkg.id, rawAddressText);
        ok++;
      } catch {
        failed++;
      }
    }
    setBusyAll(false);
    toast({
      title:
        failed > 0 ? `${ok} resueltos, ${failed} fallaron` : `${ok} paquetes resueltos`,
      variant: failed > 0 ? "error" : "success",
    });
    onResolved();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackageSearch className="size-4" /> Bandeja de resolución
          {items && items.length > 0 && <Badge variant="warning">{items.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!items || items.length === 0 ? (
          <p className="text-text-muted text-sm">
            No hay paquetes esperando dirección. Ningún paquete queda fuera del sistema —
            si algo no se puede resolver, aparece acá.
          </p>
        ) : (
          <>
            {readyToResolve.length > 1 && (
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleResolveAll()}
                  disabled={busyAll || busyId !== null}
                >
                  Resolver todos ({readyToResolve.length})
                </Button>
              </div>
            )}
            {items.map((pkg) => (
              <div
                key={pkg.id}
                className="border-border flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{pkg.internalCode}</div>
                  <div className="text-text-muted text-xs">
                    {pkg.trackingCode ?? "sin código de proveedor"}
                    {pkg.recipientName ? ` · ${pkg.recipientName}` : ""}
                  </div>
                </div>
                <Input
                  placeholder="Dirección completa"
                  className="sm:w-72"
                  value={drafts[pkg.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [pkg.id]: e.target.value }))}
                />
                <Button
                  size="sm"
                  onClick={() => void handleResolve(pkg.id)}
                  disabled={busyId === pkg.id || busyAll}
                >
                  Resolver
                </Button>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ActionsCard({
  operation,
  onChanged,
}: {
  operation: OperationItem;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<"geocode" | "close" | null>(null);
  const [reconciliation, setReconciliation] =
    React.useState<CloseOperationResponse | null>(null);

  async function handleGeocode() {
    setBusy("geocode");
    try {
      const summary = await api.post<GeocodeSummary>(
        `/api/operations/${operation.id}/geocode`,
      );
      toast({
        title: `${summary.geocoded} geocodificados, ${summary.failed} fallidos`,
        variant: summary.failed > 0 ? "error" : "success",
      });
      onChanged();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo geocodificar",
        variant: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleClose() {
    setBusy("close");
    try {
      const result = await api.post<CloseOperationResponse>(
        `/api/operations/${operation.id}/close`,
      );
      setReconciliation(result);
      toast({ title: "Operación cerrada", variant: "success" });
      onChanged();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo cerrar",
        variant: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Acciones</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void handleGeocode()}
            disabled={busy !== null}
          >
            Geocodificar en lote
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleClose()}
            disabled={busy !== null}
          >
            Cerrar operación
          </Button>
        </div>
        {reconciliation && (
          <div className="text-sm">
            <p>
              Esperados: {reconciliation.reconciliation.expected} · Recibidos:{" "}
              {reconciliation.reconciliation.received}
            </p>
            {reconciliation.reconciliation.missing.length > 0 && (
              <p className="text-status-warning">
                Faltantes:{" "}
                {reconciliation.reconciliation.missing
                  .map((m) => m.trackingCode)
                  .join(", ")}
              </p>
            )}
            {reconciliation.reconciliation.surplus.length > 0 && (
              <p className="text-status-info">
                Sobrantes:{" "}
                {reconciliation.reconciliation.surplus
                  .map((m) => m.trackingCode)
                  .join(", ")}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
