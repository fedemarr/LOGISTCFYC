"use client";

import * as React from "react";
import QRCode from "qrcode";
import {
  Check,
  ClipboardList,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Truck,
  X,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { ErrorState, TableSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DialogRoot,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
 * CHOFERES (FYM) — lista de choferes y generación del QR de identificación.
 * El QR codifica la URL de la PWA con el token (`{origin}/chofer?t=…`) que
 * se guarda hasheado en `users.qr_token_hash`. Autentica SOLO.
 *
 * También los turnos PENDING (pedido de Fede: "pago x paquete") — la IA
 * ya intentó confirmar sola la cantidad declarada contra la captura de
 * Flex; lo que llega acá es lo que la IA no pudo resolver sola.
 */

interface DriverItem {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  hasQr: boolean;
}

interface ZoneOption {
  id: string;
  name: string;
}

interface PendingShift {
  id: string;
  packageCount: number;
  startedAt: string;
  driver: { id: string; fullName: string };
  zone: { id: string; name: string };
  aiAnalysis: {
    detectedCount: number | null;
    confidence: "high" | "medium" | "low";
    reasoning: string;
  } | null;
  screenshotUrl: string | null;
}

export default function ChoferesPage() {
  const { toast } = useToast();
  const [drivers, setDrivers] = React.useState<DriverItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);
  const [qrDriver, setQrDriver] = React.useState<DriverItem | null>(null);
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [qrGenerating, setQrGenerating] = React.useState(false);

  const [pending, setPending] = React.useState<PendingShift[]>([]);
  const [pendingBusyId, setPendingBusyId] = React.useState<string | null>(null);

  // Asignar turno (pedido de Fede: "que el admin pueda pre-armar el
  // turno") — zona + paquetes, el chofer solo toca "Iniciar" en la PWA.
  const [zones, setZones] = React.useState<ZoneOption[]>([]);
  const [assignDriver, setAssignDriver] = React.useState<DriverItem | null>(null);
  const [assignZoneName, setAssignZoneName] = React.useState("");
  const [assignPackageCount, setAssignPackageCount] = React.useState("");
  const [assigning, setAssigning] = React.useState(false);

  React.useEffect(() => {
    api
      .get<{ zones: ZoneOption[] }>("/api/zones")
      .then((data) => setZones(data.zones))
      .catch(() => {
        // el datalist de sugerencias no bloquea el resto de la pantalla
      });
  }, []);

  async function handleAssignShift() {
    if (!assignDriver || !assignZoneName.trim() || !assignPackageCount) return;
    setAssigning(true);
    try {
      await api.post(`/api/choferes/${assignDriver.id}/assign-shift`, {
        zoneName: assignZoneName.trim(),
        packageCount: Number(assignPackageCount),
      });
      toast({
        title: `Turno asignado a ${assignDriver.fullName} — solo falta que toque "Iniciar"`,
        variant: "success",
      });
      setAssignDriver(null);
      setAssignZoneName("");
      setAssignPackageCount("");
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo asignar el turno",
        variant: "error",
      });
    } finally {
      setAssigning(false);
    }
  }

  function loadPending() {
    return api
      .get<{ items: PendingShift[] }>("/api/choferes/shifts")
      .then((data) => setPending(data.items))
      .catch(() => {
        // no bloquea el resto de la pantalla
      });
  }

  async function handleConfirmShift(shift: PendingShift) {
    setPendingBusyId(shift.id);
    try {
      await api.post(`/api/choferes/shifts/${shift.id}/confirm`);
      toast({
        title: `Turno de ${shift.driver.fullName} confirmado`,
        variant: "success",
      });
      await loadPending();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo confirmar el turno",
        variant: "error",
      });
    } finally {
      setPendingBusyId(null);
    }
  }

  async function handleRejectShift(shift: PendingShift) {
    setPendingBusyId(shift.id);
    try {
      await api.post(`/api/choferes/shifts/${shift.id}/reject`, {});
      toast({
        title: `Turno de ${shift.driver.fullName} rechazado`,
        variant: "success",
      });
      await loadPending();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo rechazar el turno",
        variant: "error",
      });
    } finally {
      setPendingBusyId(null);
    }
  }

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: PendingShift[] }>("/api/choferes/shifts")
      .then((data) => {
        if (!cancelled) setPending(data.items);
      })
      .catch(() => {
        // no bloquea el resto de la pantalla
      });
    const interval = window.setInterval(() => void loadPending(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  async function load() {
    try {
      const data = await api.get<{ drivers: DriverItem[] }>("/api/choferes");
      setError(null);
      setDrivers(data.drivers);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ drivers: DriverItem[] }>("/api/choferes")
      .then((data) => {
        if (cancelled) return;
        setError(null);
        setDrivers(data.drivers);
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

  async function handleQr(driver: DriverItem) {
    setQrDriver(driver);
    setQrGenerating(true);
    setQrDataUrl(null);
    try {
      const { token } = await api.post<{ token: string }>(
        `/api/choferes/${driver.id}/qr`,
      );
      const url = `${window.location.origin}/chofer?t=${token}`;
      const dataUrl = await QRCode.toDataURL(url, { width: 260, margin: 2 });
      setQrDataUrl(dataUrl);
      toast({ title: `QR generado para ${driver.fullName}`, variant: "success" });
      await load();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo generar el QR",
        variant: "error",
      });
    } finally {
      setQrGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Choferes"
        description="Generá el QR de identificación que el chofer escanea para ingresar a la app (autentica sin usuario ni clave)."
      />

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="text-status-warning size-4" />
              Turnos pendientes de confirmar ({pending.length})
            </CardTitle>
            <p className="text-text-muted text-sm">
              La IA no confirmó sola la cantidad declarada — revisá la captura y confirmá
              o rechazá.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {pending.map((shift) => (
              <div
                key={shift.id}
                className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start"
              >
                {shift.screenshotUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Supabase Storage
                  <img
                    src={shift.screenshotUrl}
                    alt={`Captura de Flex de ${shift.driver.fullName}`}
                    className="h-32 w-24 shrink-0 rounded-md border object-cover"
                  />
                ) : (
                  <div className="text-text-muted flex h-32 w-24 shrink-0 items-center justify-center rounded-md border text-xs">
                    sin captura
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{shift.driver.fullName}</p>
                  <p className="text-text-muted text-xs">
                    {shift.zone.name} · declaró {shift.packageCount} paquetes
                  </p>
                  {shift.aiAnalysis ? (
                    <p className="text-text-muted mt-1 text-xs">
                      IA: {shift.aiAnalysis.detectedCount ?? "no pudo contar"} detectados
                      (confianza {shift.aiAnalysis.confidence}) —{" "}
                      {shift.aiAnalysis.reasoning}
                    </p>
                  ) : (
                    <p className="text-text-muted mt-1 text-xs">
                      La IA todavía no está configurada — confirmación manual.
                    </p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      disabled={pendingBusyId === shift.id}
                      onClick={() => void handleConfirmShift(shift)}
                    >
                      <Check className="size-4" /> Confirmar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingBusyId === shift.id}
                      onClick={() => void handleRejectShift(shift)}
                    >
                      <X className="size-4" /> Rechazar
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        {loading && !drivers.length && <TableSkeleton columns={4} rows={5} />}
        {error && (
          <ErrorState
            title="No se pudieron cargar los choferes"
            description={error.message}
            onRetry={() => void load()}
          />
        )}
        {!loading && !error && drivers.length === 0 && (
          <p className="text-text-muted p-6 text-sm">
            Todavía no hay choferes con rol «driver». Creá uno desde Usuarios.
          </p>
        )}
        {drivers.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Chofer</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>QR</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-64" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {drivers.map((driver) => (
                <TableRow key={driver.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Truck className="text-primary size-4" />
                      <div>
                        <p className="text-sm font-medium">{driver.fullName}</p>
                        <p className="text-text-muted text-xs">{driver.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-text-muted">{driver.phone ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={driver.hasQr ? "success" : "neutral"}>
                      {driver.hasQr ? "asignado" : "pendiente"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={driver.isActive ? "success" : "neutral"}>
                      {driver.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" onClick={() => void handleQr(driver)}>
                        {driver.hasQr ? <RefreshCw /> : <QrCode />}
                        {driver.hasQr ? "Rotar QR" : "Generar QR"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAssignDriver(driver)}
                      >
                        <ClipboardList /> Asignar turno
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
        open={!!qrDriver}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setQrDriver(null);
            setQrDataUrl(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>QR de {qrDriver?.fullName}</DialogTitle>
          <DialogDescription>
            El chofer lo escanea con la cámara del teléfono: abre la app FYM e inicia
            sesión de forma automática. Rotar el QR invalida los anteriores.
          </DialogDescription>
          <div className="flex flex-col items-center gap-3 py-2">
            {qrGenerating && !qrDataUrl && (
              <p className="text-text-muted text-sm">Generando…</p>
            )}
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt={`QR de identificación de ${qrDriver?.fullName}`}
                className="size-64 rounded-lg border"
              />
            )}
          </div>
        </DialogContent>
      </DialogRoot>

      <DialogRoot
        open={!!assignDriver}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setAssignDriver(null);
            setAssignZoneName("");
            setAssignPackageCount("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>Asignar turno a {assignDriver?.fullName}</DialogTitle>
          <DialogDescription>
            Le arma el turno vos — el chofer no declara nada: escanea el QR y solo toca
            &quot;Iniciar&quot;.
          </DialogDescription>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assign-zone">Zona de reparto</Label>
              <Input
                id="assign-zone"
                list="assign-zone-suggestions"
                value={assignZoneName}
                onChange={(e) => setAssignZoneName(e.target.value)}
                placeholder="ej. Moreno, Buenos Aires"
              />
              <datalist id="assign-zone-suggestions">
                {zones.map((z) => (
                  <option key={z.id} value={z.name} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assign-count">Paquetes</Label>
              <Input
                id="assign-count"
                type="number"
                min={1}
                value={assignPackageCount}
                onChange={(e) => setAssignPackageCount(e.target.value)}
              />
            </div>
            <Button
              disabled={assigning || !assignZoneName.trim() || !assignPackageCount}
              onClick={() => void handleAssignShift()}
            >
              <ClipboardList /> {assigning ? "Asignando…" : "Asignar turno"}
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}
