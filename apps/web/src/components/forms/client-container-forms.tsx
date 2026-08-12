"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  api,
  type ClientItem,
  type ContainerType,
  type ContainerItem,
} from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export function ClientForm({ item }: { item?: ClientItem }) {
  const router = useRouter();
  const { toast } = useToast();

  const [name, setName] = React.useState(item?.name ?? "");
  const [contact, setContact] = React.useState(item?.contact ?? "");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (item) {
        await api.patch(`/api/clients/${item.id}`, { name, contact: contact || null });
        toast({ title: "Cliente actualizado", variant: "success" });
      } else {
        await api.post("/api/clients", { name, contact: contact || null });
        toast({ title: "Cliente creado", variant: "success" });
      }
      router.push("/clientes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-lg flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Nombre</Label>
        <Input
          id="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Proveedor Demo"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contact">Contacto</Label>
        <Input
          id="contact"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Email o teléfono"
        />
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
          {submitting ? "Guardando…" : item ? "Guardar cambios" : "Crear cliente"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/clientes")}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

const CONTAINER_TYPES: { value: ContainerType; label: string }[] = [
  { value: "BAG", label: "Bolsón" },
  { value: "CART", label: "Carro" },
  { value: "CAGE", label: "Jaula" },
  { value: "SHELF", label: "Estante" },
];

export function ContainerForm({ item }: { item?: ContainerItem }) {
  const router = useRouter();
  const { toast } = useToast();

  const [code, setCode] = React.useState(item?.code ?? "");
  const [type, setType] = React.useState<ContainerType>(item?.type ?? "BAG");
  const [qrPayload, setQrPayload] = React.useState(item?.qrPayload ?? "");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (item) {
        await api.patch(`/api/containers/${item.id}`, {
          code,
          type,
          qrPayload: qrPayload || null,
        });
        toast({ title: "Contenedor actualizado", variant: "success" });
      } else {
        await api.post("/api/containers", { code, type, qrPayload: qrPayload || null });
        toast({ title: "Contenedor creado", variant: "success" });
      }
      router.push("/contenedores");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-lg flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">Código</Label>
          <Input
            id="code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="CONT-006"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="type">Tipo</Label>
          <Select
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value as ContainerType)}
          >
            {CONTAINER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="qrPayload">Payload QR</Label>
        <Input
          id="qrPayload"
          value={qrPayload}
          onChange={(e) => setQrPayload(e.target.value)}
          placeholder="Opcional"
        />
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
          {submitting ? "Guardando…" : item ? "Guardar cambios" : "Crear contenedor"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/contenedores")}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
