"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { api, type ClientItem, type Page } from "@/lib/api/client";
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

export default function ClientesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = React.useState<ClientItem | null>(null);
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
      return api.get<Page<ClientItem>>(`/api/clients?${query.toString()}`);
    },
    [],
  );
  const list = useResourceList<ClientItem>(fetcher);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.del(`/api/clients/${deleteTarget.id}`);
      toast({ title: "Cliente eliminado", variant: "success" });
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
        title="Clientes"
        description="Empresas y comercios que reciben envíos."
        action={
          <Button render={<Link href="/clientes/nuevo" />}>
            <Plus />
            Nuevo cliente
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
            title="No hay clientes"
            description="Cargá clientes para poder asignarlos a los paquetes."
            actionLabel="Crear cliente"
            onAction={() => router.push("/clientes/nuevo")}
          />
        )}
        {list.status === "ready" && !empty && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Contacto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-text-muted">{c.contact ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={c.isActive ? "success" : "neutral"}>
                      {c.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <RowActions
                      onEdit={() => router.push(`/clientes/${c.id}/editar`)}
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
              {list.data.meta.total} {list.data.meta.total === 1 ? "cliente" : "clientes"}
            </span>
            <Pagination meta={list.data.meta} onPageChange={(p) => list.setPage(p)} />
          </div>
        )}
      </Card>

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Eliminar cliente"
        description={`¿Seguro que querés eliminar ${deleteTarget?.name ?? "este cliente"}? Se quitará de la base de clientes.`}
        busy={deleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
