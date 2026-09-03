"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Camera,
  CheckCircle2,
  Clock,
  Flag,
  Layers,
  MapPin,
  Navigation,
  Package,
  Phone,
  Play,
  Radio,
  Send,
} from "lucide-react";
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
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { DeliveryPointsMap, type DeliveryPoint } from "@/components/delivery-points-map";

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
  activeShift: {
    id: string;
    startedAt: string;
    status: "PENDING" | "ACTIVE";
    assignedByAdmin?: boolean;
  } | null;
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
  status: "PENDING" | "ACTIVE";
  /** El admin/despachante pre-armó este turno (pedido de Fede) — el
   * chofer no declaró nada, solo tiene que tocar "Iniciar". */
  assignedByAdmin?: boolean;
}

/** Pedido de Tienda Nube asignado al turno — "Mis pedidos" (pedido de
 * Fede: apartado de mapa con puntos a entregar + foto de confirmación). */
interface Order {
  id: string;
  orderNumber: string;
  customerName: string | null;
  customerPhone: string | null;
  shippingAddress: string | null;
  shippingCity: string | null;
  lat: number | null;
  lng: number | null;
  status: "PENDING" | "ASSIGNED" | "DELIVERED" | "FAILED" | "CANCELLED";
}

/** Comprime una imagen (canvas, máx 1600px de lado, JPEG 75%) antes de
 * mandarla en el body del POST — una captura de cámara sin comprimir
 * puede pesar varios MB y pegarle al límite de tamaño de la función
 * serverless. */
async function compressScreenshot(
  file: File,
): Promise<{ base64: string; mimeType: string }> {
  const bitmap = await createImageBitmap(file);
  const maxDim = 1600;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no se pudo preparar la imagen");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("no se pudo comprimir la imagen"))),
      "image/jpeg",
      0.75,
    ),
  );
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error as unknown as Error);
    reader.readAsDataURL(blob);
  });
  return { base64, mimeType: "image/jpeg" };
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
  // Captura de Flex (pedido de Fede: "pago x paquete") — la IA la lee y
  // confirma sola si coincide, si no queda pendiente de que alguien del
  // depósito la revise a mano.
  const [screenshotPreview, setScreenshotPreview] = React.useState<string | null>(null);
  const [screenshotFile, setScreenshotFile] = React.useState<File | null>(null);

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

  // Cierre — se pide lo ENTREGADO (lo que importa para el pago, "pago x
  // paquete") y se deriva cuántos faltaron, no al revés.
  const [closing, setClosing] = React.useState(false);
  const [delivered, setDelivered] = React.useState("");

  // Problema de entrega (pedido de Fede) — fire-and-forget: el chofer
  // reporta y sigue manejando, control llama al teléfono del destinatario.
  const [deliveryReason, setDeliveryReason] = React.useState<
    "" | "NOT_HOME" | "REFUSED" | "OTHER"
  >("");
  const [deliveryPhone, setDeliveryPhone] = React.useState("");
  const [deliveryNote, setDeliveryNote] = React.useState("");
  const [reportingDelivery, setReportingDelivery] = React.useState(false);

  // Mis pedidos (pedido de Fede: mapa + marcar entregado con foto) — los
  // pedidos de Tienda Nube que el despachante asignó a este turno.
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [deliveringOrderId, setDeliveringOrderId] = React.useState<string | null>(null);
  const [deliveryEvidenceFile, setDeliveryEvidenceFile] = React.useState<File | null>(
    null,
  );
  const [submittingDelivery, setSubmittingDelivery] = React.useState(false);

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
            status: data.activeShift.status,
            assignedByAdmin: data.activeShift.assignedByAdmin,
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
          // Este endpoint solo devuelve turnos ACTIVE (ver
          // `getActiveShiftForDriver` en el backend) — si estuviera
          // PENDING acá da null y el polling de abajo se encarga.
          setShift({ ...reportData.shift, status: "ACTIVE" });
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

  // ── 3.5. Turno PENDING: esperar confirmación (IA o depósito) ──
  React.useEffect(() => {
    if (!token || shift?.status !== "PENDING") return;
    let cancelled = false;
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const data = await driverApi<{
            shift: {
              id: string;
              zoneId: string;
              packageCount: number;
              startedAt: string;
              status: "PENDING" | "ACTIVE";
            } | null;
          }>("/api/chofer/shifts");
          if (cancelled) return;
          if (!data.shift) {
            // Lo rechazaron — vuelve a la pantalla de arranque.
            setShift(null);
            shiftRef.current = { zoneId: "", active: false };
            toast({
              title:
                "El depósito no confirmó el turno — revisá la cantidad y probá de nuevo.",
              variant: "error",
            });
            return;
          }
          if (data.shift.status === "ACTIVE") {
            setShift({ ...data.shift });
            shiftRef.current = { zoneId: data.shift.zoneId, active: true };
            setLastReportAt(new Date(data.shift.startedAt));
            toast({ title: "Turno confirmado — ¡a repartir!", variant: "success" });
          }
        } catch {
          // Sigue esperando — no corta el polling por un error de red suelto.
        }
      })();
    }, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [token, shift?.status, toast]);

  // ── 4. GPS en vivo + temporizador del turno ──
  React.useEffect(() => {
    if (!shift || shift.status !== "ACTIVE" || !token) return;

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

  // ── 5. Mis pedidos: cargar y refrescar mientras el turno está ACTIVO ──
  React.useEffect(() => {
    if (!token || shift?.status !== "ACTIVE") return;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await driverApi<{ orders: Order[] }>("/api/chofer/orders");
        if (!cancelled) setOrders(data.orders);
      } catch {
        // Se ignora — la lista se reintenta sola en el próximo poll.
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [token, shift?.status]);

  // ── Registro del service worker (PWA) ──
  React.useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  async function handleStart() {
    if (!zoneName.trim() || !packageCount || !screenshotFile) return;
    setStarting(true);
    try {
      const { base64, mimeType } = await compressScreenshot(screenshotFile);
      const data = await driverApi<{ shift: ShiftState }>("/api/chofer/shifts", {
        method: "POST",
        body: JSON.stringify({
          zoneName: zoneName.trim(),
          packageCount: Number(packageCount),
          flexScreenshotBase64: base64,
          flexScreenshotMimeType: mimeType,
        }),
      });
      setShift(data.shift);
      shiftRef.current = {
        zoneId: data.shift.zoneId,
        active: data.shift.status === "ACTIVE",
      };
      setLastReportAt(new Date(data.shift.startedAt));
      setTimer("00:00:00");
      setScreenshotFile(null);
      setScreenshotPreview(null);
      toast({
        title:
          data.shift.status === "ACTIVE"
            ? "Turno confirmado por IA — ¡a repartir!"
            : "Turno arrancado — esperando que el depósito confirme la cantidad.",
        variant: "success",
      });
    } catch (err) {
      toast({ title: errMessage(err), variant: "error" });
    } finally {
      setStarting(false);
    }
  }

  async function handleStartAssigned() {
    setStarting(true);
    try {
      const data = await driverApi<{ shift: ShiftState }>("/api/chofer/shifts/start", {
        method: "POST",
      });
      setShift(data.shift);
      shiftRef.current = { zoneId: data.shift.zoneId, active: true };
      setLastReportAt(new Date(data.shift.startedAt));
      setTimer("00:00:00");
      toast({ title: "Turno iniciado — ¡a repartir!", variant: "success" });
    } catch (err) {
      toast({ title: errMessage(err), variant: "error" });
    } finally {
      setStarting(false);
    }
  }

  function handleScreenshotChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setScreenshotFile(file);
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshotPreview(file ? URL.createObjectURL(file) : null);
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

  async function handleReportDelivery() {
    if (!shift || !deliveryReason) return;
    setReportingDelivery(true);
    try {
      await driverApi("/api/chofer/delivery-alerts", {
        method: "POST",
        body: JSON.stringify({
          reason: deliveryReason,
          contactPhone: deliveryPhone.trim() || undefined,
          note: deliveryNote.trim() || undefined,
        }),
      });
      setDeliveryReason("");
      setDeliveryPhone("");
      setDeliveryNote("");
      toast({
        title: "Problema reportado — control llama al número cargado.",
        variant: "success",
      });
    } catch (err) {
      toast({ title: errMessage(err), variant: "error" });
    } finally {
      setReportingDelivery(false);
    }
  }

  function openInMaps(order: Order) {
    const url =
      order.lat != null && order.lng != null
        ? `https://www.google.com/maps/dir/?api=1&destination=${order.lat},${order.lng}`
        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
            [order.shippingAddress, order.shippingCity].filter(Boolean).join(", "),
          )}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleDeliveryEvidenceChange(e: React.ChangeEvent<HTMLInputElement>) {
    setDeliveryEvidenceFile(e.target.files?.[0] ?? null);
  }

  async function handleConfirmDelivered(orderId: string) {
    if (!deliveryEvidenceFile) return;
    setSubmittingDelivery(true);
    try {
      const { base64, mimeType } = await compressScreenshot(deliveryEvidenceFile);
      await driverApi(`/api/chofer/orders/${orderId}/deliver`, {
        method: "POST",
        body: JSON.stringify({
          evidenceBase64: base64,
          evidenceMimeType: mimeType,
        }),
      });
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: "DELIVERED" } : o)),
      );
      setDeliveringOrderId(null);
      setDeliveryEvidenceFile(null);
      toast({ title: "Pedido marcado como entregado", variant: "success" });
    } catch (err) {
      toast({ title: errMessage(err), variant: "error" });
    } finally {
      setSubmittingDelivery(false);
    }
  }

  async function handleEnd() {
    if (!shift) return;
    const deliveredCount = Number(delivered);
    const missing = Math.max(0, shift.packageCount - deliveredCount);
    setClosing(true);
    try {
      await driverApi("/api/chofer/shifts/end", {
        method: "POST",
        body: JSON.stringify({ undeliveredCount: missing, notes: undefined }),
      });
      toast({
        title:
          `Turno cerrado — duró ${timer}. Entregaste ${deliveredCount}/${shift.packageCount}` +
          (missing > 0 ? `, faltaron ${missing}.` : "."),
        variant: "success",
      });
      setShift(null);
      setGeofence(null);
      setLastReportAt(null);
      setLastPackagesDone(null);
      setDelivered("");
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
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="screenshot" className="flex items-center gap-1.5">
                  <Camera className="size-4" /> Captura de Flex
                </Label>
                <p className="text-text-muted text-xs">
                  Subí la captura de tus envíos de Flex — confirma que la cantidad es
                  real.
                </p>
                <Input
                  id="screenshot"
                  type="file"
                  accept="image/*"
                  onChange={handleScreenshotChange}
                />
                {screenshotPreview && (
                  // eslint-disable-next-line @next/next/no-img-element -- preview local (object URL)
                  <img
                    src={screenshotPreview}
                    alt="Vista previa de la captura de Flex"
                    className="mt-1 max-h-40 rounded-md border object-contain"
                  />
                )}
              </div>
              <Button
                disabled={
                  starting || !zoneName.trim() || !packageCount || !screenshotFile
                }
                onClick={() => void handleStart()}
              >
                <Play /> {starting ? "Confirmando…" : "Arrancar turno"}
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

      {/* Turno PENDING asignado por el admin: solo falta tocar "Iniciar" */}
      {!loadingSession &&
        token &&
        shift &&
        shift.status === "PENDING" &&
        shift.assignedByAdmin && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <Play className="text-primary size-10" />
              <p className="font-medium">Turno asignado</p>
              <p className="text-text-muted text-sm">
                El depósito te armó el turno: {shift.packageCount} paquetes. Tocá
                &quot;Iniciar&quot; cuando salgas a repartir.
              </p>
              <Button disabled={starting} onClick={() => void handleStartAssigned()}>
                <Play /> {starting ? "Iniciando…" : "Iniciar"}
              </Button>
            </CardContent>
          </Card>
        )}

      {/* Turno PENDING declarado por el chofer: esperando que la IA o el depósito confirmen */}
      {!loadingSession &&
        token &&
        shift &&
        shift.status === "PENDING" &&
        !shift.assignedByAdmin && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <Clock className="text-primary size-10 animate-pulse" />
              <p className="font-medium">Esperando confirmación</p>
              <p className="text-text-muted text-sm">
                Declaraste {shift.packageCount} paquetes. La IA está revisando la captura
                — si no le cierra el número, alguien del depósito la revisa a mano. Esta
                pantalla se actualiza sola.
              </p>
            </CardContent>
          </Card>
        )}

      {/* Turno activo */}
      {!loadingSession && token && shift && shift.status === "ACTIVE" && (
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
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="text-primary size-4" /> Mis pedidos
              </CardTitle>
              <p className="text-text-muted text-sm">
                Pedidos de Tienda Nube que te asignaron para este turno.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {orders.length === 0 ? (
                <p className="text-text-muted text-sm">
                  Todavía no te asignaron pedidos.
                </p>
              ) : (
                <>
                  <div className="h-64 overflow-hidden rounded-md border">
                    <DeliveryPointsMap
                      className="h-full w-full"
                      points={orders
                        .filter(
                          (o): o is Order & { lat: number; lng: number } =>
                            o.lat != null && o.lng != null,
                        )
                        .map<DeliveryPoint>((o) => ({
                          id: o.id,
                          lat: o.lat,
                          lng: o.lng,
                          label: `#${o.orderNumber} — ${o.customerName ?? "sin nombre"}`,
                          delivered: o.status === "DELIVERED",
                        }))}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    {orders.map((o) => {
                      const delivered = o.status === "DELIVERED";
                      return (
                        <div
                          key={o.id}
                          className="flex flex-col gap-2 rounded-md border p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="flex items-center gap-1.5 text-sm font-medium">
                                {delivered && (
                                  <CheckCircle2 className="size-4 text-emerald-500" />
                                )}
                                Pedido #{o.orderNumber}
                              </p>
                              <p className="text-text-muted text-xs">
                                {o.customerName ?? "Sin nombre"}
                                {o.customerPhone ? ` · ${o.customerPhone}` : ""}
                              </p>
                              <p className="text-text-muted text-xs">
                                {[o.shippingAddress, o.shippingCity]
                                  .filter(Boolean)
                                  .join(", ") || "Sin dirección"}
                              </p>
                            </div>
                          </div>
                          {!delivered && (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => openInMaps(o)}
                              >
                                <Navigation className="size-4" /> Cómo llegar
                              </Button>
                              {deliveringOrderId !== o.id && (
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => {
                                    setDeliveringOrderId(o.id);
                                    setDeliveryEvidenceFile(null);
                                  }}
                                >
                                  <Camera className="size-4" /> Marcar entregado
                                </Button>
                              )}
                            </div>
                          )}
                          {!delivered && deliveringOrderId === o.id && (
                            <div className="flex flex-col gap-2 rounded-md border border-dashed p-2">
                              <Label htmlFor={`evidence-${o.id}`} className="text-xs">
                                Foto de confirmación (obligatoria)
                              </Label>
                              <Input
                                id={`evidence-${o.id}`}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={handleDeliveryEvidenceChange}
                              />
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={submittingDelivery || !deliveryEvidenceFile}
                                  onClick={() => void handleConfirmDelivered(o.id)}
                                >
                                  {submittingDelivery ? "Enviando…" : "Confirmar entrega"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={submittingDelivery}
                                  onClick={() => {
                                    setDeliveringOrderId(null);
                                    setDeliveryEvidenceFile(null);
                                  }}
                                >
                                  Cancelar
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
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
              <CardTitle className="flex items-center gap-2 text-base">
                <Phone className="text-primary size-4" /> Reportar problema de entrega
              </CardTitle>
              <p className="text-text-muted text-sm">
                No estaba el destinatario o rechazó el paquete — cargá el teléfono que
                figura en el envío (si lo tenés) y control lo llama directo. Seguís
                manejando, no tenés que frenar.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="d-reason">¿Qué pasó?</Label>
                <Select
                  id="d-reason"
                  value={deliveryReason}
                  onChange={(e) =>
                    setDeliveryReason(e.target.value as typeof deliveryReason)
                  }
                >
                  <option value="">Elegí el motivo…</option>
                  <option value="NOT_HOME">No está el destinatario</option>
                  <option value="REFUSED">Rechazó el paquete</option>
                  <option value="OTHER">Otro</option>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="d-phone">Teléfono de contacto (opcional)</Label>
                <Input
                  id="d-phone"
                  type="tel"
                  inputMode="tel"
                  value={deliveryPhone}
                  onChange={(e) => setDeliveryPhone(e.target.value)}
                  placeholder="El que está en el envío, para que control llame"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="d-note">Nota (opcional)</Label>
                <Input
                  id="d-note"
                  value={deliveryNote}
                  onChange={(e) => setDeliveryNote(e.target.value)}
                  placeholder="ej. no atiende el portero, dejó dicho otra cosa…"
                />
              </div>
              <Button
                variant="outline"
                disabled={reportingDelivery || !deliveryReason}
                onClick={() => void handleReportDelivery()}
              >
                <Send /> {reportingDelivery ? "Enviando…" : "Reportar problema"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cerrar turno</CardTitle>
              <p className="text-text-muted text-sm">
                Llevás {timer} de turno. Contá cuántos entregaste de verdad — es lo que se
                paga.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="delivered" className="flex items-center gap-1.5">
                  <Package className="size-4" /> Paquetes entregados
                </Label>
                <Input
                  id="delivered"
                  type="number"
                  min={0}
                  max={shift.packageCount}
                  value={delivered}
                  onChange={(e) => setDelivered(e.target.value)}
                  placeholder={`¿Cuántos de ${shift.packageCount} entregaste?`}
                />
              </div>
              {delivered !== "" && !Number.isNaN(Number(delivered)) && (
                <p
                  className={
                    Number(delivered) < shift.packageCount
                      ? "text-status-warning text-sm"
                      : "text-text-muted text-sm"
                  }
                >
                  {Number(delivered) < shift.packageCount
                    ? `Faltan ${shift.packageCount - Number(delivered)} de ${shift.packageCount}.`
                    : "Entregaste todos. 👍"}
                </p>
              )}
              <Button
                variant="destructive"
                disabled={
                  closing ||
                  delivered === "" ||
                  Number(delivered) < 0 ||
                  Number(delivered) > shift.packageCount
                }
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
