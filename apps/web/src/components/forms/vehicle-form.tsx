"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  api,
  type UserItem,
  type VehicleItem,
  type VehicleStatus,
} from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const VEHICLE_STATUSES: { value: VehicleStatus; label: string }[] = [
  { value: "AVAILABLE", label: "Disponible" },
  { value: "IN_ROUTE", label: "En ruta" },
  { value: "MAINTENANCE", label: "En mantenimiento" },
  { value: "OUT_OF_SERVICE", label: "Fuera de servicio" },
];

export function VehicleForm({ item }: { item?: VehicleItem }) {
  const router = useRouter();
  const { toast } = useToast();

  const [drivers, setDrivers] = React.useState<UserItem[]>([]);
  const [plate, setPlate] = React.useState(item?.plate ?? "");
  const [brand, setBrand] = React.useState(item?.brand ?? "");
  const [model, setModel] = React.useState(item?.model ?? "");
  const [year, setYear] = React.useState(item?.year?.toString() ?? "");
  const [capacityPackages, setCapacityPackages] = React.useState(
    item?.capacityPackages?.toString() ?? "",
  );
  const [status, setStatus] = React.useState<VehicleStatus>(item?.status ?? "AVAILABLE");
  const [assignedDriverId, setAssignedDriverId] = React.useState(
    item?.assignedDriverId ?? "",
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api
      .get<{ items: UserItem[] }>("/api/users?role=driver&pageSize=100")
      .then((data) => setDrivers(data.items))
      .catch(() => setDrivers([]));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const payload = {
      plate,
      brand: brand || null,
      model: model || null,
      year: year ? Number(year) : null,
      capacityPackages: capacityPackages ? Number(capacityPackages) : null,
      status,
      assignedDriverId: assignedDriverId || null,
    };

    try {
      if (item) {
        await api.patch(`/api/vehicles/${item.id}`, payload);
        toast({ title: "Vehículo actualizado", variant: "success" });
      } else {
        await api.post("/api/vehicles", payload);
        toast({ title: "Vehículo creado", variant: "success" });
      }
      router.push("/vehiculos");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-lg flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plate">Patente</Label>
          <Input
            id="plate"
            required
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            placeholder="AB123CD"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Estado</Label>
          <Select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as VehicleStatus)}
          >
            {VEHICLE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brand">Marca</Label>
          <Input
            id="brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Renault"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="model">Modelo</Label>
          <Input
            id="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Kangoo"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="year">Año</Label>
          <Input
            id="year"
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="2020"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="capacityPackages">Capacidad (paquetes)</Label>
          <Input
            id="capacityPackages"
            type="number"
            value={capacityPackages}
            onChange={(e) => setCapacityPackages(e.target.value)}
            placeholder="60"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assignedDriverId">Chofer asignado</Label>
        <Select
          id="assignedDriverId"
          value={assignedDriverId}
          onChange={(e) => setAssignedDriverId(e.target.value)}
        >
          <option value="">Sin asignar</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName} ({d.email})
            </option>
          ))}
        </Select>
      </div>

      {error && (
        <p
          className="bg-status-danger/10 text-status-danger rounded-md px-3 py-2 text-sm"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Guardando…" : item ? "Guardar cambios" : "Crear vehículo"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/vehiculos")}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
