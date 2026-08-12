import { PageHeader } from "@/components/page-header";
import { UserForm } from "@/components/forms/user-form";

export default function NuevoUsuarioPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Nuevo usuario"
        description="Crea el acceso y los roles de un miembro del equipo."
      />
      <UserForm />
    </div>
  );
}
