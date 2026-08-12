"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { api, type VehicleItem } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { VehicleForm } from "@/components/forms/vehicle-form";
import { ErrorState, TableSkeleton } from "@/components/states";

export default function EditarVehiculoPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = React.useState<VehicleItem | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<VehicleItem>(`/api/vehicles/${id}`)
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
        title="Editar vehículo"
        description="Actualizá los datos y el estado de la flota."
      />
      {status === "loading" && <TableSkeleton columns={2} rows={3} />}
      {status === "error" && <ErrorState onRetry={() => setStatus("loading")} />}
      {status === "ready" && item && <VehicleForm item={item} />}
    </div>
  );
}
