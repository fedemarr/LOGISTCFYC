import { PageHeader } from "@/components/page-header";
import { ContainerForm } from "@/components/forms/client-container-forms";

export default function NuevoContenedorPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Nuevo contenedor"
        description="Cargá un contenedor del depósito."
      />
      <ContainerForm />
    </div>
  );
}
