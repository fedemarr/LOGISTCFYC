"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CircleDot, Phone, Radio, Truck } from "lucide-react";
import { api } from "@/lib/api/client";
import { createSupabaseClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/page-header";
import { ErrorState, TableSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FleetMap, type MapZone, type MapDriver } from "@/components/fleet-map";

/**
 * MONITOREO EN VIVO (FYM) — mapa con zonas (geocercas) y posiciones de
 * choferes con turno activo, refrescado cada 10 s.
 */
interface LiveDriver {
  shift: { id: string; packageCount: number; startedAt: string };
  driver: { id: string; fullName: string; phone: string | null };
  zone: {
    id: string;
    name: string;
    colorHex: string;
    centerLat: number;
    centerLng: number;
    radiusM: number;
  };
  lastLocation: { lat: number; lng: number; recordedAt: string } | null;
  gpsAgeMinutes: number | null;
  outside: boolean;
  distanceFromCenterM: number | null;
  openAlert: { id: string; triggeredAt: string } | null;
  lastReport: { packagesDone: number; reportedAt: string; note: string | null } | null;
  reportOverdue: boolean;
}

export default function MonitoreoPage() {
  const router = useRouter();
  const [fleet, setFleet] = React.useState<LiveDriver[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);
  const [lastUpdate, setLastUpdate] = React.useState<Date | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function load() {
      try {
        const data = await api.get<{ fleet: LiveDriver[] }>("/api/monitoring/live");
        if (cancelled) return;
        setFleet(data.fleet);
        setLastUpdate(new Date());
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error) {
          if (err.message.includes("401") || err.name === "ApiClientError") {
            const supabase = createSupabaseClient();
            await supabase.auth.signOut();
            router.replace("/login");
            return;
          }
          setError(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
      timer = setTimeout(load, 10_000);
    }

    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [router]);

  const zones: MapZone[] = fleet.map((f) => f.zone);
  const drivers: MapDriver[] = fleet
    .filter((f) => f.lastLocation)
    .map((f) => ({
      id: f.shift.id,
      fullName: f.driver.fullName,
      lat: f.lastLocation!.lat,
      lng: f.lastLocation!.lng,
      outside: f.outside,
    }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Monitoreo"
        description="Posición de los choferes en turno — refresca cada 10 s."
        action={
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              <Radio className="mr-1 size-3.5" />
              {loading ? "cargando…" : `${fleet.length} en turno`}
            </Badge>
            {lastUpdate && (
              <span className="text-text-muted text-xs">
                última actualización {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </div>
        }
      />

      <Card className="h-[28rem] w-full overflow-hidden">
        {error ? (
          <ErrorState
            title="No se pudo cargar el monitoreo"
            description={error.message}
          />
        ) : loading ? (
          <TableSkeleton rows={3} />
        ) : (
          <FleetMap zones={zones} drivers={drivers} className="h-full w-full" />
        )}
      </Card>

      {fleet.length === 0 && !loading && !error && (
        <p className="text-text-muted text-sm">No hay choferes con turno activo ahora.</p>
      )}

      <div className="flex flex-col gap-2">
        {fleet.map((f) => {
          const gpsSilence = f.gpsAgeMinutes !== null && f.gpsAgeMinutes > 5;
          return (
            <Card key={f.shift.id} className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Truck className="text-primary size-4" />
                  <div>
                    <p className="text-sm font-medium">{f.driver.fullName}</p>
                    <p className="text-text-muted text-xs">
                      {f.zone.name} · {f.driver.phone ?? "sin teléfono"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {f.outside ? (
                    <Badge className="bg-destructive text-white">
                      <AlertTriangle className="mr-1 size-3" /> afuera de zona
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <CircleDot className="mr-1 size-3 text-emerald-500" /> dentro de
                      zona
                    </Badge>
                  )}
                  {gpsSilence && (
                    <Badge variant="neutral">
                      sin GPS {Math.round(f.gpsAgeMinutes ?? 0)} min
                    </Badge>
                  )}
                  {f.reportOverdue && <Badge variant="neutral">aviso vencido</Badge>}
                  {f.openAlert && (
                    <Badge className="bg-amber-500 text-white">alerta abierta</Badge>
                  )}
                  {f.driver.phone && (
                    <Button
                      variant="outline"
                      size="sm"
                      render={<a href={`tel:${f.driver.phone}`} />}
                    >
                      <Phone className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
