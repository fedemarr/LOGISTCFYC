import { PageHeader } from "@/components/page-header";
import { VehicleForm } from "@/components/forms/vehicle-form";

export default function NuevoVehiculoPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Nuevo vehículo" description="Cargá un vehículo a la flota." />
      <VehicleForm />
    </div>
  );
}
