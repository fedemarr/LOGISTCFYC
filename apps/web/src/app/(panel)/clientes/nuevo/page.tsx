import { PageHeader } from "@/components/page-header";
import { ClientForm } from "@/components/forms/client-container-forms";

export default function NuevoClientePage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Nuevo cliente"
        description="Cargá una empresa o comercio que recibe envíos."
      />
      <ClientForm />
    </div>
  );
}
