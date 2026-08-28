"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Clock, Flag, Layers, Package, Play, Radio, Send } from "lucide-react";
import {
  driverApi,
  getStoredToken,
  storeToken,
  clearToken,
  DriverApiError,
} from "@/lib/api/driver-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";

/**
 * APP DEL CHOFER (FYM) — PWA mobile-first.
 *
 * Flujo:
 *  1. Escanea el QR → abre `/chofer?t=<token>` → se guarda el token (localStorage).
 *  2. Sesión resuelta en `/api/chofer/session`.
 *  3. Sin turno → elegís zona + paquetes del depósito y arrancás el turno.
 *  4. En turno → GPS en vivo (cada ~10 s) + aviso de avance cada 2 h + cierre.
 */
interface Session {
  user: { id: string; email: string; fullName: string; phone: string | null };
  hasActiveShift: boolean;
  activeShift: { id: string; startedAt: string } | null;
}

interface Zone {
  id: string;
  name: string;
  colorHex: string;
  centerLat: number;
  centerLng: number;
  radiusM: number;
}

interface ShiftState {
  id: string;
  packageCount: number;
  startedAt: string;
  zoneId: string;
}

export default function ChoferApp() {
  return (
    <React.Suspense fallback={null}>
      <ChoferAppInner />
    </React.Suspense>
  );
}

// `useSearchParams()` obliga a envolver en Suspense (Next.js App Router:
// si no, el build de producción falla al prerenderizar /chofer con "CSR
// bailout" — no es opcional, es requisito del framework).
function ChoferAppInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [token, setToken] = React.useState<string | null>(() =>
    typeof window === "undefined" ? null : getStoredToken(),
  );
  const [session, setSession] = React.useState<Session | null>(null);
  const [zones, setZones] = React.useState<Zone[]>([]);
  const [shift, setShift] = React.useState<ShiftState | null>(null);
  const [loadingSession, setLoadingSession] = React.useState(() => token !== null);

  // Turno nuevo — la zona se ESCRIBE (pedido de Fede), no se elige de una
  // lista fija: se geocodifica en el backend al arrancar el turno. Las
  // zonas ya existentes de la org se ofrecen como sugerencias (datalist)
  // pero no limitan lo que se puede tipear.
  const [zoneName, setZoneName] = React.useState("");
  const [packageCount, setPackageCount] = React.useState("");
  const [starting, setStarting] = React.useState(false);

  // Avance
  const [packagesDone, setPackagesDone] = React.useState("");
  const [note, setNote] = React.useState("");
  const [reporting, setReporting] = React.useState(false);
  const [lastReportAt, setLastReportAt] = React.useState<Date | null>(null);
  const [lastPackagesDone, setLastPackagesDone] = React.useState<number | null>(null);
  const [minutesSinceReport, setMinutesSinceReport] = React.useState<number | null>(null);
  const lastReportAtRef = React.useRef<Date | null>(null);

  React.useEffect(() => {
    lastReportAtRef.current = lastReportAt;
  }, [lastReportAt]);

  // Cierre
  const [closing, setClosing] = React.useState(false);
  const [undelivered, setUndelivered] = React.useState("");

  // GPS
  const [gpsStatus, setGpsStatus] = React.useState<"off" | "on" | "error">("off");
  const [geofence, setGeofence] = React.useState<{
    outside: boolean;
    distanceM: number;
  } | null>(null);
  const [timer, setTimer] = React.useState("00:00:00");

  const watchId = React.useRef<number | null>(null);
  const locationRef = React.useRef<{ lat: number; lng: number } | null>(null);
  const shiftRef = React.useRef<{ zoneId: string; active: boolean }>({
    zoneId: "",
    active: false,
  });

  // ── 1. Token: de la URL (?t=…) o del localStorage ──
  React.useEffect(() => {
    const fromUrl = searchParams.get("t");
    if (!fromUrl) return;
    storeToken(fromUrl);
    router.replace("/chofer");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(fromUrl);
  }, [searchParams, router]);

  // ── 2. Sesión ──
  React.useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await driverApi<Session>("/api/chofer/session", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
        if (cancelled) return;
        setSession(data);
        if (data.hasActiveShift && data.activeShift) {
          setShift({
            id: data.activeShift.id,
            packageCount: 0,
            startedAt: data.activeShift.startedAt,
            zoneId: "",
          });
          shiftRef.current = { zoneId: "", active: true };
        }
      } catch {
        if (cancelled) return;
        clearToken();
        toast({
          title: "QR inválido o expirado. Pedile al administrador uno nuevo.",
          variant: "error",
        });
        setToken(null);
      } finally {
        if (!cancelled) setLoadingSession(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, toast]);

  // ── 3. Cargar detalle del turno en curso (si hay), zonas para arrancar ──
  React.useEffect(() => {
    if (!token || !session) return;
    let cancelled = false;
    (async () => {
      try {
        const [reportData, zonesData] = await Promise.all([
          driverApi<{
            shift: {
              id: string;
              packageCount: number;
              startedAt: string;
              status: string;
              zoneId: string;
            } | null;
            lastReport: {
              packagesDone: number;
              reportedAt: string;
              note: string | null;
            } | null;
          }>("/api/chofer/shifts/report"),
          driverApi<{ zones: Zone[] }>("/api/chofer/zones"),
        ]);
        if (cancelled) return;
        setZones(zonesData.zones);
        if (reportData.shift) {
          setShift({ ...reportData.shift });
          shiftRef.current = { zoneId: reportData.shift.zoneId, active: true };
          setLastReportAt(
            reportData.lastReport
              ? new Date(reportData.lastReport.reportedAt)
              : new Date(reportData.shift.startedAt),
          );
          setLastPackagesDone(reportData.lastReport?.packagesDone ?? 0);
          setPackagesDone(String(reportData.lastReport?.packagesDone ?? ""));
        }
      } catch {
        // El detalle del turno puede fallar si expiró la sesión; se ignora.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, session]);

  // ── 4. GPS en vivo + temporizador del turno ──
  React.useEffect(() => {
    if (!shift || !token) return;

    const startGps = () => {
      if (watchId.current !== null) return;
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          setGpsStatus("on");
          locationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          void driverApi("/api/chofer/location", {
            method: "POST",
            body: JSON.stringify({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracyM: pos.coords.accuracy,
              speedMps: pos.coords.speed ?? undefined,
              heading: pos.coords.heading ?? undefined,
              recordedAt: new Date().toISOString(),
            }),
          })
            .then((r) => {
              const res = r as {
                geofence: { outside: boolean; distanceM: number } | null;
              };
              if (res.geofence) setGeofence(res.geofence);
            })
            .catch(() => setGpsStatus("error"));
        },
        () => setGpsStatus("error"),
        {
          enableHighAccuracy: true,
          maximumAge: 5_000,
          timeout: 15_000,
        },
      );
      watchId.current = id;
    };

    startGps();

    const start = new Date(shift.startedAt);
    const interval = window.setInterval(() => {
      const diff = Math.max(0, Date.now() - start.getTime());
      const h = Math.floor(diff / 3_600_000)
        .toString()
        .padStart(2, "0");
      const m = Math.floor((diff % 3_600_000) / 60_000)
        .toString()
        .padStart(2, "0");
      const s = Math.floor((diff % 60_000) / 1_000)
        .toString()
        .padStart(2, "0");
      setTimer(`${h}:${m}:${s}`);
      const last = lastReportAtRef.current;
      setMinutesSinceReport(
        last ? Math.floor((Date.now() - last.getTime()) / 60_000) : null,
      );
    }, 1_000);

    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      window.clearInterval(interval);
    };
  }, [shift, token]);

  // ── Registro del service worker (PWA) ──
  React.useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  async function handleStart() {
    if (!zoneName.trim() || !packageCount) return;
    setStarting(true);
    try {
      const data = await driverApi<{ shift: ShiftState }>("/api/chofer/shifts", {
        method: "POST",
        body: JSON.stringify({
          zoneName: zoneName.trim(),
          packageCount: Number(packageCount),
        }),
      });
      setShift(data.shift);
      shiftRef.current = { zoneId: data.shift.zoneId, active: true };
      setLastReportAt(new Date(data.shift.startedAt));
      setTimer("00:00:00");
      toast({ title: "Turno iniciado", variant: "success" });
    } catch (err) {
      toast({ title: errMessage(err), variant: "error" });
    } finally {
      setStarting(false);
    }
  }

  async function handleReport() {
    if (!shift) return;
    setReporting(true);
    try {
      const data = await driverApi<{ lastReportedAt: string | null }>(
        "/api/chofer/shifts/report",
        {
          method: "POST",
          body: JSON.stringify({
            packagesDone: Number(packagesDone),
            note: note.trim() || undefined,
          }),
        },
      );
      setLastReportAt(data.lastReportedAt ? new Date(data.lastReportedAt) : new Date());
      setLastPackagesDone(Number(packagesDone));
      setNote("");
      toast({ title: "Avance registrado", variant: "success" });
    } catch (err) {
      toast({ title: errMessage(err), variant: "error" });
    } finally {
      setReporting(false);
    }
  }

  async function handleEnd() {
    if (!shift) return;
    setClosing(true);
    try {
      await driverApi("/api/chofer/shifts/end", {
        method: "POST",
        body: JSON.stringify({
          undeliveredCount: Number(undelivered) || 0,
          notes: undefined,
        }),
      });
      toast({ title: "Turno cerrado. ¡Buen laburo!", variant: "success" });
      setShift(null);
      setGeofence(null);
      setLastReportAt(null);
      setLastPackagesDone(null);
      setUndelivered("");
    } catch (err) {
      toast({ title: errMessage(err), variant: "error" });
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">FYM · Chofer</h1>
        {session ? (
          <div className="text-right">
            <p className="text-sm font-medium">{session.user.fullName}</p>
            <p className="text-text-muted text-xs">
              {session.user.phone ?? session.user.email}
            </p>
          </div>
        ) : (
          <span className="text-text-muted text-xs">sin sesión</span>
        )}
      </header>

      {loadingSession && <p className="text-text-muted text-sm">Validando QR…</p>}

      {/* Sin token: hay que escanear el QR */}
      {!loadingSession && !token && (
        <Card className="mt-4">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <Layers className="text-primary size-10" />
            <p className="font-medium">Escaneá tu QR para entrar</p>
            <p className="text-text-muted text-sm">
              El QR del chofer abre esta app y te identifica sin usuario ni clave.
            </p>
            <Input
              placeholder="o pegá el código del QR acá"
              className="mt-2 font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = e.currentTarget.value.trim();
                  if (v) {
                    storeToken(v);
                    setToken(v);
                  }
                }
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Sin turno activo: arrancar */}
      {!loadingSession && token && session && !shift && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Play className="text-primary size-4" /> Arrancar turno
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="zone">Zona de reparto</Label>
                <Input
                  id="zone"
                  list="zone-suggestions"
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                  placeholder="Escribí dónde repartís, ej. Moreno, Buenos Aires"
                />
                <datalist id="zone-suggestions">
                  {zones.map((z) => (
                    <option key={z.id} value={z.name} />
                  ))}
                </datalist>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="count">Paquetes del depósito</Label>
                <Input
                  id="count"
                  type="number"
                  min={1}
                  value={packageCount}
                  onChange={(e) => setPackageCount(e.target.value)}
                  placeholder="¿Con cuántos salís?"
                />
              </div>
              <Button
                disabled={starting || !zoneName.trim() || !packageCount}
                onClick={() => void handleStart()}
              >
                <Play /> {starting ? "Ubicando zona…" : "Arrancar turno"}
              </Button>
            </CardContent>
          </Card>
          {session.hasActiveShift && (
            <p className="text-text-muted text-xs">
              Tenías un turno en curso, se está cargando…
            </p>
          )}
        </>
      )}

      {/* Turno activo */}
      {!loadingSession && token && shift && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="text-primary size-4" /> Turno en curso
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-md border p-3">
                <span className="text-text-muted text-sm">Tiempo</span>
                <span className="font-data text-2xl">{timer}</span>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <span className="text-text-muted text-sm">Paquetes</span>
                <span className="font-data text-2xl">{lastPackagesDone ?? 0}</span>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <span className="text-text-muted text-sm">GPS</span>
                <span className="flex items-center gap-1.5 text-sm">
                  <Radio
                    className={
                      gpsStatus === "on"
                        ? "size-4 text-emerald-500"
                        : "text-destructive size-4"
                    }
                  />
                  {gpsStatus === "on"
                    ? "enviando"
                    : gpsStatus === "error"
                      ? "sin señal"
                      : "apagado"}
                </span>
              </div>

              {geofence && geofence.outside && (
                <div className="border-destructive text-destructive rounded-md border p-3 text-sm">
                  ⚠ Saliste de tu zona ({Math.round(geofence.distanceM - 0)} m). ¡Volvé o
                  avisá por teléfono!
                </div>
              )}

              <div className="flex items-center justify-between rounded-md border p-3">
                <span className="text-text-muted text-sm">Último aviso</span>
                {minutesSinceReport !== null ? (
                  <span
                    className={
                      minutesSinceReport > 140
                        ? "text-destructive font-medium"
                        : "text-sm"
                    }
                  >
                    {minutesSinceReport >= 120
                      ? `hace ${Math.floor(minutesSinceReport / 60)} h ${minutesSinceReport % 60} m`
                      : `hace ${minutesSinceReport} m`}
                  </span>
                ) : (
                  <span className="text-text-muted text-sm">—</span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reportar avance</CardTitle>
              <p className="text-text-muted text-sm">
                Cada 2-3 horas avisá en qué paquete vas (carga manual).
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="done">¿En qué paquete vas?</Label>
                <Input
                  id="done"
                  type="number"
                  min={0}
                  value={packagesDone}
                  onChange={(e) => setPackagesDone(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="note">Nota (opcional)</Label>
                <Input
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="ej. zona cargada, atasco, etc."
                />
              </div>
              <Button
                disabled={reporting || packagesDone === ""}
                onClick={() => void handleReport()}
              >
                <Send /> {reporting ? "Enviando…" : "Enviar aviso"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cerrar turno</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="undelivered" className="flex items-center gap-1.5">
                  <Package className="size-4" /> Paquetes sin repartir
                </Label>
                <Input
                  id="undelivered"
                  type="number"
                  min={0}
                  value={undelivered}
                  onChange={(e) => setUndelivered(e.target.value)}
                  placeholder="0"
                />
              </div>
              <Button
                variant="destructive"
                disabled={closing}
                onClick={() => void handleEnd()}
              >
                <Flag /> {closing ? "Cerrando…" : "Terminar turno"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {!loadingSession && token && !shift && !session?.hasActiveShift && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            clearToken();
            setToken(null);
            setSession(null);
          }}
        >
          Cerrar sesión (borrar QR)
        </Button>
      )}
    </div>
  );
}

function errMessage(err: unknown): string {
  if (err instanceof DriverApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
