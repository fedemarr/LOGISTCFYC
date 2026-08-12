"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { api, type ContainerItem, type ContainerType, type Page } from "@/lib/api/client";
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

const TYPE_LABELS: Record<ContainerType, string> = {
  BAG: "Bolsón",
  CART: "Carro",
  CAGE: "Jaula",
  SHELF: "Estante",
};

export default function ContenedoresPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = React.useState<ContainerItem | null>(null);
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
      return api.get<Page<ContainerItem>>(`/api/containers?${query.toString()}`);
    },
    [],
  );
  const list = useResourceList<ContainerItem>(fetcher);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.del(`/api/containers/${deleteTarget.id}`);
      toast({ title: "Contenedor eliminado", variant: "success" });
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
        title="Contenedores"
        description="Depósitos reutilizables que agrupan paquetes."
        action={
          <Button render={<Link href="/contenedores/nuevo" />}>
            <Plus />
            Nuevo contenedor
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
          <TableSkeleton columns={3} rows={6} />
        )}
        {list.status === "error" && <ErrorState onRetry={list.reload} />}
        {empty && (
          <EmptyState
            title="No hay contenedores"
            description="Cargá contenedores para agrupar los paquetes del depósito."
            actionLabel="Crear contenedor"
            onAction={() => router.push("/contenedores/nuevo")}
          />
        )}
        {list.status === "ready" && !empty && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Payload QR</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.code}</TableCell>
                  <TableCell className="text-text-muted">{TYPE_LABELS[c.type]}</TableCell>
                  <TableCell className="text-text-muted max-w-64 truncate">
                    {c.qrPayload ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.isActive ? "success" : "neutral"}>
                      {c.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <RowActions
                      onEdit={() => router.push(`/contenedores/${c.id}/editar`)}
                      onDelete={() => setDeleteTarget(c)}
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
              {list.data.meta.total === 1 ? "contenedor" : "contenedores"}
            </span>
            <Pagination meta={list.data.meta} onPageChange={(p) => list.setPage(p)} />
          </div>
        )}
      </Card>

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Eliminar contenedor"
        description={`¿Seguro que querés eliminar ${deleteTarget?.code ?? "este contenedor"}? Ya no podrá agrupar paquetes.`}
        busy={deleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
