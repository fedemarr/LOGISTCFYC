"use client";

import * as React from "react";
import QRCode from "qrcode";
import { QrCode, RefreshCw, Truck } from "lucide-react";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { ErrorState, TableSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
 * CHOFERES (FYM) — lista de choferes y generación del QR de identificación.
 * El QR codifica la URL de la PWA con el token (`{origin}/chofer?t=…`) que
 * se guarda hasheado en `users.qr_token_hash`. Autentica SOLO.
 */

interface DriverItem {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  hasQr: boolean;
}

export default function ChoferesPage() {
  const { toast } = useToast();
  const [drivers, setDrivers] = React.useState<DriverItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);
  const [qrDriver, setQrDriver] = React.useState<DriverItem | null>(null);
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [qrGenerating, setQrGenerating] = React.useState(false);

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
                <TableHead className="w-32" />
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
                    <Button size="sm" onClick={() => void handleQr(driver)}>
                      {driver.hasQr ? <RefreshCw /> : <QrCode />}
                      {driver.hasQr ? "Rotar QR" : "Generar QR"}
                    </Button>
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
    </div>
  );
}
