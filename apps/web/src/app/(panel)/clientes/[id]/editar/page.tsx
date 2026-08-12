"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { api, type ClientItem } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { ClientForm } from "@/components/forms/client-container-forms";
import { ErrorState, TableSkeleton } from "@/components/states";

export default function EditarClientePage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = React.useState<ClientItem | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<ClientItem>(`/api/clients/${id}`)
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
      <PageHeader title="Editar cliente" description="Actualizá los datos del cliente." />
      {status === "loading" && <TableSkeleton columns={2} rows={3} />}
      {status === "error" && <ErrorState onRetry={() => setStatus("loading")} />}
      {status === "ready" && item && <ClientForm item={item} />}
    </div>
  );
}
