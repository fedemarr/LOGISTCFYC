"use client";

import * as React from "react";
import { api, type Page } from "@/lib/api/client";
import type { PackageStatus } from "@fyc/state-machine";
import { useResourceList } from "@/lib/hooks/use-resource-list";
import { PageHeader } from "@/components/page-header";
import { SearchBar } from "@/components/search-bar";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PackageItem {
  id: string;
  internalCode: string;
  trackingCode: string | null;
  status: PackageStatus;
  recipientName: string | null;
  rawAddressText: string | null;
  destinationConfidence: string | null;
  priority: number;
  createdAt: string;
}

const STATUS_LABELS: Record<PackageStatus, string> = {
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

const STATUS_VARIANTS: Record<
  PackageStatus,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  PENDIENTE_RESOLUCION: "warning",
  RECIBIDO: "neutral",
  GEOCODIFICADO: "neutral",
  ASIGNADO: "info",
  CARGADO: "info",
  EN_REPARTO: "info",
  EN_DOMICILIO: "info",
  ENTREGADO: "success",
  FALLA_REPORTADA: "warning",
  REPROGRAMADO: "warning",
  DEVUELTO: "neutral",
  EXTRAVIADO: "danger",
  DANIADO: "danger",
  CANCELADO: "neutral",
};

const dateFormat = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export default function PaquetesPage() {
  const fetcher = React.useCallback(
    async ({
      page,
      pageSize,
      search,
    }: {
      page: number;
      pageSize: number;
      search?: string;
    }) => {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search) query.set("search", search);
      return api.get<Page<PackageItem>>(`/api/packages?${query.toString()}`);
    },
    [],
  );
  const list = useResourceList<PackageItem>(fetcher);

  const empty = list.status === "ready" && list.data?.items.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Paquetes"
        description="Todas las unidades del sistema con su estado actual."
      />

      <div className="flex justify-end">
        <SearchBar
          placeholder="Buscar por código…"
          defaultValue={list.search}
          onSubmit={(v) => {
            list.setPage(1);
            list.setSearch(v || undefined);
          }}
        />
      </div>

      <Card className="overflow-hidden">
        {list.status === "loading" && !list.data && (
          <TableSkeleton columns={5} rows={8} />
        )}
        {list.status === "error" && <ErrorState onRetry={list.reload} />}
        {empty && (
          <EmptyState
            title="No hay paquetes"
            description="Cuando se cargue una operación vas a ver los paquetes acá."
          />
        )}
        {list.status === "ready" && !empty && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código interno</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Destinatario</TableHead>
                <TableHead>Prioridad</TableHead>
                <TableHead>Creado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.internalCode}</TableCell>
                  <TableCell className="text-text-muted">
                    {p.trackingCode ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[p.status]}>
                      {STATUS_LABELS[p.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-text-muted">
                    {p.recipientName ?? "—"}
                  </TableCell>
                  <TableCell>
                    {p.priority >= 1 ? (
                      <Badge variant="danger">Alta</Badge>
                    ) : (
                      <span className="text-text-muted text-sm">Normal</span>
                    )}
                  </TableCell>
                  <TableCell className="text-text-muted whitespace-nowrap">
                    {dateFormat.format(new Date(p.createdAt))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {list.data && list.data.meta.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
            <span className="text-text-muted text-sm">
              {list.data.meta.total} {list.data.meta.total === 1 ? "paquete" : "paquetes"}
            </span>
            <Pagination meta={list.data.meta} onPageChange={(p) => list.setPage(p)} />
          </div>
        )}
      </Card>
    </div>
  );
}
