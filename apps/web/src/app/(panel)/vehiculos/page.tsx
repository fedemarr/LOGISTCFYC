"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { api, type Page, type VehicleItem, type VehicleStatus } from "@/lib/api/client";
import { useResourceList } from "@/lib/hooks/use-resource-list";
import { PageHeader } from "@/components/page-header";
import { SearchBar } from "@/components/search-bar";
import { RowActions } from "@/components/row-actions";
import { ConfirmDeleteDialog } from "@/components/confirm-delete";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/components/ui/toast";

const STATUS_LABELS: Record<
  VehicleStatus,
  { label: string; variant: "success" | "info" | "warning" | "neutral" }
> = {
  AVAILABLE: { label: "Disponible", variant: "success" },
  IN_ROUTE: { label: "En ruta", variant: "info" },
  MAINTENANCE: { label: "Mantenimiento", variant: "warning" },
  OUT_OF_SERVICE: { label: "Fuera de servicio", variant: "neutral" },
};

export default function VehiculosPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = React.useState<VehicleItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);

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
      return api.get<Page<VehicleItem>>(`/api/vehicles?${query.toString()}`);
    },
    [],
  );
  const list = useResourceList<VehicleItem>(fetcher);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.del(`/api/vehicles/${deleteTarget.id}`);
      toast({ title: "Vehículo eliminado", variant: "success" });
      setDeleteTarget(null);
      await list.reload();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo eliminar",
        variant: "error",
      });
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  const empty = list.status === "ready" && list.data?.items.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Vehículos"
        description="Flota: capacidad, estado y chofer asignado."
        action={
          <Button render={<Link href="/vehiculos/nuevo" />}>
            <Plus />
            Nuevo vehículo
          </Button>
        }
      />

      <div className="flex justify-end">
        <SearchBar
          defaultValue={list.search}
          onSubmit={(v) => {
            list.setPage(1);
            list.setSearch(v || undefined);
          }}
        />
      </div>

      <Card className="overflow-hidden">
        {list.status === "loading" && !list.data && (
          <TableSkeleton columns={5} rows={6} />
        )}
        {list.status === "error" && <ErrorState onRetry={list.reload} />}
        {empty && (
          <EmptyState
            title="No hay vehículos"
            description="Cargá la flota para poder asignar rutas y repartos."
            actionLabel="Crear vehículo"
            onAction={() => router.push("/vehiculos/nuevo")}
          />
        )}
        {list.status === "ready" && !empty && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patente</TableHead>
                <TableHead>Vehículo</TableHead>
                <TableHead>Capacidad</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Chofer</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.items.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.plate}</TableCell>
                  <TableCell className="text-text-muted">
                    {[v.brand, v.model, v.year].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="text-text-muted">
                    {v.capacityPackages ? `${v.capacityPackages} paq.` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_LABELS[v.status].variant}>
                      {STATUS_LABELS[v.status].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-text-muted">
                    {v.assignedDriverName ?? "—"}
                  </TableCell>
                  <TableCell>
                    <RowActions
                      onEdit={() => router.push(`/vehiculos/${v.id}/editar`)}
                      onDelete={() => setDeleteTarget(v)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {list.data && list.data.meta.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
            <span className="text-text-muted text-sm">
              {list.data.meta.total}{" "}
              {list.data.meta.total === 1 ? "vehículo" : "vehículos"}
            </span>
            <Pagination meta={list.data.meta} onPageChange={(p) => list.setPage(p)} />
          </div>
        )}
      </Card>

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Eliminar vehículo"
        description={`¿Seguro que querés eliminar ${deleteTarget?.plate ?? "este vehículo"}? No aparecerá más en la flota.`}
        busy={deleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
