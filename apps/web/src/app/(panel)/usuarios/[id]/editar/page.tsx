"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { api, type UserItem } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { UserForm } from "@/components/forms/user-form";
import { ErrorState, TableSkeleton } from "@/components/states";

export default function EditarUsuarioPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = React.useState<UserItem | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<UserItem>(`/api/users/${id}`)
      .then((data) => {
        if (cancelled) return;
        setItem(data);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Editar usuario"
        description="Actualizá el perfil, roles o estado de acceso."
      />
      {status === "loading" && <TableSkeleton columns={2} rows={3} />}
      {status === "error" && <ErrorState onRetry={() => setStatus("loading")} />}
      {status === "ready" && item && <UserForm item={item} />}
    </div>
  );
}
