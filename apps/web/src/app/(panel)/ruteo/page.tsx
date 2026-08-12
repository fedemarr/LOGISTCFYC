"use client";

import * as React from "react";
import { Loader2, Route as RouteIcon } from "lucide-react";
import { api, type OperationItem, type Page, type RouteItem } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, TableSkeleton } from "@/components/states";
import { useToast } from "@/components/ui/toast";
import { RouteCard } from "./route-card";

/**
 * `/ruteo` — planificador (§8, etapa 3 aplicada). FASE 6: funcional, sin el
 * mapa MapLibre ni el drag & drop del mockup todavía — eso llega con el
 * rediseño visual de PROMPT-FRONTEND-V2 sobre esta misma pantalla. Acá ya
 * están las tres operaciones que importan: generar la propuesta, mover un
 * bulto entre rutas, aprobar (congela `bulk_number`) e imprimir etiquetas.
 */
export default function RuteoPage() {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [operation, setOperation] = React.useState<OperationItem | null>(null);
  const [routeList, setRouteList] = React.useState<RouteItem[] | null>(null);
  const [generating, setGenerating] = React.useState(false);

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

  const loadRoutes = React.useCallback(async (operationId: string) => {
    try {
      const result = await api.get<{ items: RouteItem[] }>(
        `/api/operations/${operationId}/routes`,
      );
      setRouteList(result.items);
    } catch {
      // no bloquea el resto de la pantalla
    }
  }, []);

  React.useEffect(() => {
    if (!operation) return;
    let cancelled = false;
    void (async () => {
      await loadRoutes(operation.id);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [operation, loadRoutes]);

  async function handleGenerate() {
    if (!operation) return;
    setGenerating(true);
    try {
      await api.post(`/api/operations/${operation.id}/routes`);
      toast({ title: "Propuesta de rutas generada", variant: "success" });
      await loadRoutes(operation.id);
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo generar la propuesta",
        variant: "error",
      });
    } finally {
      setGenerating(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Ruteo" description="Agrupamiento y secuenciación (§8)" />
        <TableSkeleton columns={3} rows={4} />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Ruteo" description="Agrupamiento y secuenciación (§8)" />
        <ErrorState onRetry={loadOperation} />
      </div>
    );
  }
  if (!operation) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Ruteo" description="Agrupamiento y secuenciación (§8)" />
        <Card>
          <CardContent className="text-text-muted p-6 text-sm">
            No hay una operación abierta. Creá una desde{" "}
            <a href="/deposito" className="text-primary underline">
              Depósito
            </a>{" "}
            primero.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Ruteo"
        description={`Operación ${operation.operationDate} · propone el algoritmo, dispone el dispatcher (§8)`}
      />

      {(!routeList || routeList.length === 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Generar propuesta de rutas</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-text-muted text-sm">
              Cluster geográfico capacitado + secuenciación por calle real sobre los
              paquetes GEOCODIFICADO de esta operación (§8). Necesita al menos un vehículo
              AVAILABLE con chofer asignado.
            </p>
            <Button
              onClick={() => void handleGenerate()}
              disabled={generating}
              className="w-fit"
            >
              {generating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RouteIcon className="size-4" />
              )}
              Generar propuesta
            </Button>
          </CardContent>
        </Card>
      )}

      {routeList && routeList.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {routeList.map((route) => (
            <RouteCard
              key={route.id}
              route={route}
              allRoutes={routeList}
              onChanged={() => void loadRoutes(operation.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
