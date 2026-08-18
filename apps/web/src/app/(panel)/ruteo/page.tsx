"use client";

import * as React from "react";
import { Loader2, Route as RouteIcon } from "lucide-react";
import {
  api,
  type ContainerItem,
  type OperationItem,
  type Page,
  type RouteDetail,
  type RouteItem,
} from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState, TableSkeleton } from "@/components/states";
import { useToast } from "@/components/ui/toast";
import { RouteCard } from "./route-card";
import { RouteMap } from "./route-map";

interface RoutesResponse {
  items: RouteItem[];
  depot: { lat: number; lng: number } | null;
  freePackageCount: number;
}

/**
 * `/ruteo` — planificador (§8 completo: clustering + secuencia real +
 * mapa + ajuste manual + aprobar + imprimir). Layout de dos columnas
 * (tarjetas de ruta | mapa) como en el mockup, con las tres operaciones
 * que importan: generar la propuesta, mover un bulto entre rutas
 * (recalcula en vivo, ver ADR-036), aprobar (congela `bulk_number`) e
 * imprimir etiquetas.
 */
export default function RuteoPage() {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [operation, setOperation] = React.useState<OperationItem | null>(null);
  const [routeList, setRouteList] = React.useState<RouteItem[] | null>(null);
  const [depot, setDepot] = React.useState<{ lat: number; lng: number } | null>(null);
  const [details, setDetails] = React.useState<Record<string, RouteDetail>>({});
  const [hoveredRouteId, setHoveredRouteId] = React.useState<string | null>(null);
  const [generating, setGenerating] = React.useState(false);
  const [containers, setContainers] = React.useState<ContainerItem[]>([]);
  const [freePackageCount, setFreePackageCount] = React.useState(0);

  React.useEffect(() => {
    void (async () => {
      try {
        const page = await api.get<Page<ContainerItem>>("/api/containers?pageSize=100");
        setContainers(page.items);
      } catch {
        // no bloquea el resto de la pantalla — sin esto solo no se puede asignar contenedor
      }
    })();
  }, []);

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
      const result = await api.get<RoutesResponse>(
        `/api/operations/${operationId}/routes`,
      );
      setRouteList(result.items);
      setDepot(result.depot);
      setFreePackageCount(result.freePackageCount);
      const pairs = await Promise.all(
        result.items.map(async (r) => {
          try {
            return [r.id, await api.get<RouteDetail>(`/api/routes/${r.id}`)] as const;
          } catch {
            return null;
          }
        }),
      );
      setDetails(Object.fromEntries(pairs.filter((p) => p !== null)));
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

  const hasRoutes = !!routeList && routeList.length > 0;

  return (
    <div className="-m-4 flex h-[calc(100dvh-2rem)] flex-col sm:-m-6 sm:h-[calc(100dvh-3rem)]">
      <div className="flex shrink-0 items-center justify-between px-4 pt-4 sm:px-6 sm:pt-6">
        <PageHeader title="Ruteo" description={`Op. ${operation.operationDate}`} />
        <div className="flex items-center gap-3">
          <span className="font-data text-text-muted hidden text-xs sm:inline">
            {freePackageCount} sin ruta
          </span>
          <Button
            onClick={() => void handleGenerate()}
            disabled={generating || freePackageCount === 0}
            size="sm"
          >
            {generating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RouteIcon className="size-4" />
            )}
            {hasRoutes ? "Agregar ruta" : "Generar propuesta"}
          </Button>
        </div>
      </div>

      {routeList && routeList.length > 0 && (
        <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[380px_1fr]">
          <div className="border-border bg-surface flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain border-r p-3">
            {routeList.map((route) => (
              <RouteCard
                key={route.id}
                route={route}
                allRoutes={routeList}
                containers={containers}
                detail={details[route.id]}
                hovered={hoveredRouteId === route.id}
                onHoverChange={setHoveredRouteId}
                onChanged={() => void loadRoutes(operation.id)}
              />
            ))}
          </div>
          <div className="hidden min-h-[420px] lg:block">
            <RouteMap
              routes={routeList}
              details={details}
              depot={depot}
              hoveredRouteId={hoveredRouteId}
            />
          </div>
        </div>
      )}
    </div>
  );
}
