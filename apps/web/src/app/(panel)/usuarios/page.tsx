"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { api, type Page, type UserItem } from "@/lib/api/client";
import { useResourceList } from "@/lib/hooks/use-resource-list";
import { PageHeader } from "@/components/page-header";
import { SearchBar } from "@/components/search-bar";
import { RowActions } from "@/components/row-actions";
import { ConfirmDeleteDialog } from "@/components/confirm-delete";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { RoleBadge } from "@/components/role-badge";
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

export default function UsuariosPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = React.useState<UserItem | null>(null);
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
      return api.get<Page<UserItem>>(`/api/users?${query.toString()}`);
    },
    [],
  );
  const list = useResourceList<UserItem>(fetcher);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.del(`/api/users/${deleteTarget.id}`);
      toast({ title: "Usuario eliminado", variant: "success" });
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
        title="Usuarios"
        description="Altas, roles y estados de acceso al sistema."
        action={
          <Button render={<Link href="/usuarios/nuevo" />}>
            <Plus />
            Nuevo usuario
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
            title="No hay usuarios"
            description="Creá el primer usuario para que pueda ingresar al panel."
            actionLabel="Crear usuario"
            onAction={() => router.push("/usuarios/nuevo")}
          />
        )}
        {list.status === "ready" && !empty && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.fullName}</TableCell>
                  <TableCell className="text-text-muted">{u.email}</TableCell>
                  <TableCell className="text-text-muted">{u.phone ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((role) => (
                        <RoleBadge key={role} role={role} />
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.isActive ? "success" : "neutral"}>
                      {u.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <RowActions
                      onEdit={() => router.push(`/usuarios/${u.id}/editar`)}
                      onDelete={() => setDeleteTarget(u)}
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
              {list.data.meta.total} {list.data.meta.total === 1 ? "usuario" : "usuarios"}
            </span>
            <Pagination meta={list.data.meta} onPageChange={(p) => list.setPage(p)} />
          </div>
        )}
      </Card>

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Eliminar usuario"
        description={`¿Seguro que querés eliminar a ${deleteTarget?.fullName ?? "este usuario"}? Es un borrado lógico: se desactiva y deja de poder ingresar.`}
        busy={deleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
