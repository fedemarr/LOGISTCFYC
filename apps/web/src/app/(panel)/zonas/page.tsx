"use client";

import * as React from "react";
import { MapPinned, Plus, Save, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { ErrorState, TableSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DialogRoot,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

/**
 * ZONAS (FYM) — CRUD de geocercas circulares (centro + radio). El admin
 * define dónde trabaja cada zona para que la geocerca detecte a los choferes
 * que se van afuera.
 */

interface ZoneItem {
  id: string;
  name: string;
  colorHex: string;
  centerLat: number;
  centerLng: number;
  radiusM: number;
  isActive: boolean;
}

const EMPTY_FORM = {
  name: "",
  colorHex: "#3b82f6",
  centerLat: -34.6037,
  centerLng: -58.3816,
  radiusM: 3000,
};

export default function ZonasPage() {
  const { toast } = useToast();
  const [zones, setZones] = React.useState<ZoneItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);
  const [editing, setEditing] = React.useState<{ id: string; name: string } | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [form, setForm] = React.useState<typeof EMPTY_FORM | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState<ZoneItem | null>(null);
  const [deleteBusy, setDeleteBusy] = React.useState(false);

  async function load() {
    try {
      const data = await api.get<{ zones: ZoneItem[] }>("/api/zones");
      setError(null);
      setZones(data.zones);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ zones: ZoneItem[] }>("/api/zones")
      .then((data) => {
        if (cancelled) return;
        setError(null);
        setZones(data.zones);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(zone: ZoneItem) {
    setEditing({ id: zone.id, name: zone.name });
    setForm({
      name: zone.name,
      colorHex: zone.colorHex,
      centerLat: zone.centerLat,
      centerLng: zone.centerLng,
      radiusM: zone.radiusM,
    });
    setFormOpen(true);
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    try {
      const clean = {
        name: form.name.trim(),
        colorHex: form.colorHex,
        centerLat: form.centerLat,
        centerLng: form.centerLng,
        radiusM: form.radiusM,
      };
      if (editing) {
        await api.patch(`/api/zones/${editing.id}`, clean);
      } else {
        await api.post("/api/zones", clean);
      }
      toast({ title: editing ? "Zona actualizada" : "Zona creada", variant: "success" });
      setEditing(null);
      setFormOpen(false);
      setForm(null);
      await load();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo guardar la zona",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.del(`/api/zones/${deleting.id}`);
      toast({ title: "Zona eliminada", variant: "success" });
      setDeleting(null);
      await load();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo eliminar",
        variant: "error",
      });
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Zonas"
        description="Geocercas circulares de reparto: si un chofer en turno sale del radio se genera una alerta."
        action={
          <Button onClick={openNew}>
            <Plus /> Nueva zona
          </Button>
        }
      />

      <Card className="overflow-hidden">
        {loading && !zones.length && <TableSkeleton columns={4} rows={4} />}
        {error && (
          <ErrorState
            title="No se pudieron cargar las zonas"
            description={error.message}
            onRetry={() => void load()}
          />
        )}
        {!loading && !error && zones.length === 0 && (
          <p className="text-text-muted p-6 text-sm">
            No hay zonas. Creá la primera para que los choferes puedan arrancar un turno.
          </p>
        )}
        {zones.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Zona</TableHead>
                <TableHead>Centro</TableHead>
                <TableHead>Radio</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {zones.map((zone) => (
                <TableRow key={zone.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className="size-3 rounded-full"
                        style={{ backgroundColor: zone.colorHex }}
                      />
                      <span className="text-sm font-medium">{zone.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-text-muted text-sm">
                    {zone.centerLat.toFixed(4)}, {zone.centerLng.toFixed(4)}
                  </TableCell>
                  <TableCell className="text-text-muted text-sm">
                    {zone.radiusM.toLocaleString("es-AR")} m
                  </TableCell>
                  <TableCell>
                    <Badge variant={zone.isActive ? "success" : "neutral"}>
                      {zone.isActive ? "Activa" : "Pausada"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(zone)}>
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(zone)}
                        className="text-destructive"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <DialogRoot
        open={formOpen}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setFormOpen(false);
            setForm(null);
            setEditing(null);
          }
        }}
      >
        <DialogContent>
          <DialogTitle>{editing ? `Editar ${editing.name}` : "Nueva zona"}</DialogTitle>
          <DialogDescription>
            La zona es un círculo con un centro y un radio (en metros). El chofer con
            turno activo en esta zona debe quedarse dentro.
          </DialogDescription>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label htmlFor="zone-name">Nombre</Label>
                <Input
                  id="zone-name"
                  value={form?.name ?? ""}
                  onChange={(e) =>
                    setForm({ ...(form ?? EMPTY_FORM), name: e.target.value })
                  }
                  placeholder="Paso del Rey (oeste)"
                />
              </div>
              <div>
                <Label htmlFor="zone-color">Color</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="zone-color"
                    type="color"
                    value={form?.colorHex ?? "#3b82f6"}
                    onChange={(e) =>
                      setForm({ ...(form ?? EMPTY_FORM), colorHex: e.target.value })
                    }
                    className="h-9 w-10 cursor-pointer rounded-md border"
                  />
                  <Input
                    value={form?.colorHex ?? "#3b82f6"}
                    onChange={(e) =>
                      setForm({ ...(form ?? EMPTY_FORM), colorHex: e.target.value })
                    }
                    className="w-24"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="zone-radius">Radio (m)</Label>
                <Input
                  id="zone-radius"
                  type="number"
                  min={100}
                  value={form?.radiusM ?? EMPTY_FORM.radiusM}
                  onChange={(e) =>
                    setForm({ ...(form ?? EMPTY_FORM), radiusM: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label htmlFor="zone-lat">Latitud</Label>
                <Input
                  id="zone-lat"
                  type="number"
                  step="0.0001"
                  value={form?.centerLat ?? EMPTY_FORM.centerLat}
                  onChange={(e) =>
                    setForm({
                      ...(form ?? EMPTY_FORM),
                      centerLat: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="zone-lng">Longitud</Label>
                <Input
                  id="zone-lng"
                  type="number"
                  step="0.0001"
                  value={form?.centerLng ?? EMPTY_FORM.centerLng}
                  onChange={(e) =>
                    setForm({
                      ...(form ?? EMPTY_FORM),
                      centerLng: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" disabled={saving} onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={saving || !form?.name.trim()}
              onClick={() => void handleSave()}
            >
              <Save /> {saving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>

      <DialogRoot
        open={!!deleting}
        onOpenChange={(open: boolean) => !open && setDeleting(null)}
      >
        <DialogContent>
          <DialogTitle>Eliminar zona</DialogTitle>
          <DialogDescription>
            ¿Eliminar «{deleting?.name}»? Si algún chofer tiene un turno activo en esta
            zona seguirá con su turno, pero la zona deja de estar disponible.
          </DialogDescription>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              disabled={deleteBusy}
              onClick={() => setDeleting(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteBusy}
              onClick={() => void handleDelete()}
            >
              <MapPinned /> Eliminar
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}
