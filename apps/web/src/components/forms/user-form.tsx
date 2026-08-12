"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS, ROLES, type Role } from "@fyc/shared";
import { api, type UserItem } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function UserForm({ item }: { item?: UserItem }) {
  const router = useRouter();
  const { toast } = useToast();

  const [fullName, setFullName] = React.useState(item?.fullName ?? "");
  const [email, setEmail] = React.useState(item?.email ?? "");
  const [phone, setPhone] = React.useState(item?.phone ?? "");
  const [password, setPassword] = React.useState("");
  const [isActive, setIsActive] = React.useState(item?.isActive ?? true);
  const [roles, setRoles] = React.useState<Role[]>(item?.roles ?? []);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function toggleRole(role: Role) {
    setRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (roles.length === 0) {
      setError("Asigná al menos un rol.");
      return;
    }

    setSubmitting(true);
    try {
      if (item) {
        await api.patch(`/api/users/${item.id}`, {
          fullName,
          email,
          phone: phone || null,
          isActive,
          roles,
        });
        toast({ title: "Usuario actualizado", variant: "success" });
      } else {
        if (password.length < 8) {
          setError("La contraseña debe tener al menos 8 caracteres.");
          setSubmitting(false);
          return;
        }
        await api.post("/api/users", {
          fullName,
          email,
          phone: phone || null,
          password,
          roles,
        });
        toast({ title: "Usuario creado", variant: "success" });
      }
      router.push("/usuarios");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-lg flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fullName">Nombre completo</Label>
        <Input
          id="fullName"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Nombre y apellido"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nombre@fyc.demo"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">Teléfono</Label>
        <Input
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Opcional"
        />
      </div>

      {!item && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Contraseña inicial</Label>
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres"
            minLength={8}
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label>Roles</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ROLES.map((role) => (
            <label
              key={role}
              className="border-border hover:bg-muted/40 flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm"
            >
              <Checkbox
                checked={roles.includes(role)}
                onChange={() => toggleRole(role)}
              />
              {ROLE_LABELS[role]}
            </label>
          ))}
        </div>
      </div>

      {item && (
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Activo (puede ingresar al sistema)
        </label>
      )}

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
          {submitting ? "Guardando…" : item ? "Guardar cambios" : "Crear usuario"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/usuarios")}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
