"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Radio, Truck, PackageCheck } from "lucide-react";
import { api, type MeResponse } from "@/lib/api/client";
import { createSupabaseClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Inicio del panel FYM: KPIs de control del día.
 * - Choferes en turno (frac de monitoreo en vivo).
 * - Alertas de geocerca abiertas.
 * - Avances vencidos (choferes que no reportaron a tiempo).
 * - Paquetes en ruta hoy (suma de packageCount).
 */
export default function DashboardPage() {
  const router = useRouter();
  const [orgName, setOrgName] = React.useState<string | null>(null);
  const [fleet, setFleet] = React.useState<LiveFleetItem[] | null>(null);
  const [openAlerts, setOpenAlerts] = React.useState<number | null>(null);
  const [daily, setDaily] = React.useState<DailyRow[] | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const me = await api.get<MeResponse>("/api/auth/me");
        if (cancelled) return;
        setOrgName(me.orgName);

        const [live, alerts, met] = await Promise.all([
          api.get<{ fleet: LiveFleetItem[] }>("/api/monitoring/live"),
          api.get<{ alerts: unknown[] }>("/api/alerts?status=OPEN"),
          api.get<{ rows: DailyRow[] }>(
            `/api/metricas?date=${new Date().toLocaleDateString("en-CA")}`,
          ),
        ]);
        if (cancelled) return;
        setFleet(live.fleet);
        setOpenAlerts(alerts.alerts.length);
        setDaily(met.rows);
      } catch {
        if (!cancelled) {
          const supabase = createSupabaseClient();
          await supabase.auth.signOut();
          router.replace("/login");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const activeCount = fleet?.length ?? null;
  const overdueCount = fleet?.filter((f) => f.reportOverdue || f.outside).length ?? null;
  const packagesInRoute =
    fleet?.reduce((acc, f) => acc + (f.shift?.packageCount ?? 0), 0) ?? null;
  const deliveredToday = daily?.reduce((acc, r) => acc + r.delivered, 0) ?? null;

  const cards: {
    label: string;
    value: number | null;
    icon: React.ReactNode;
    href: string;
  }[] = [
    {
      label: "Choferes en turno",
      value: activeCount,
      icon: <Truck className="size-4" />,
      href: "/monitoreo",
    },
    {
      label: "Alertas abiertas",
      value: openAlerts,
      icon: <AlertTriangle className="size-4" />,
      href: "/alertas",
    },
    {
      label: "Avisos vencidos / afuera de zona",
      value: overdueCount,
      icon: <Radio className="size-4" />,
      href: "/monitoreo",
    },
    {
      label: "Paquetes en ruta hoy",
      value: packagesInRoute,
      icon: <PackageCheck className="size-4" />,
      href: "/metricas",
    },
    {
      label: "Entregados hoy (último aviso)",
      value: deliveredToday,
      icon: <PackageCheck className="size-4" />,
      href: "/metricas",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {loading ? <Skeleton className="h-7 w-56" /> : "Panel de control FYM"}
        </h1>
        <p className="text-text-muted mt-1 text-sm">
          {orgName ?? "Control de choferes"} — estado del día en tiempo real.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="focus-visible:ring-3 focus-visible:ring-ring/40 group rounded-lg outline-none"
          >
            <Card className="group-hover:border-primary/40 transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base font-medium">{card.label}</CardTitle>
                <span className="text-text-muted">{card.icon}</span>
              </CardHeader>
              <CardContent className="pt-0">
                {loading ? (
                  <Skeleton className="h-8 w-14" />
                ) : (
                  <span className="font-data text-3xl">{card.value ?? "—"}</span>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {!loading && fleet && fleet.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">En la calle ahora</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {fleet.map((f) => (
                <li
                  key={f.shift.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span className="font-medium">{f.driver.fullName}</span>
                  <span className="text-text-muted">
                    {f.zone.name}
                    {f.gpsAgeMinutes !== null && f.gpsAgeMinutes > 5
                      ? ` · sin GPS ${Math.round(f.gpsAgeMinutes)} min`
                      : ""}
                    {f.outside ? " · AFUERA de zona" : ""}
                    {f.reportOverdue ? " · aviso vencido" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export interface LiveFleetItem {
  shift: { id: string; packageCount: number; startedAt: string };
  driver: { id: string; fullName: string; phone: string | null };
  zone: { id: string; name: string; colorHex: string };
  gpsAgeMinutes: number | null;
  outside: boolean;
  reportOverdue: boolean;
  lastLocation: {
    lat: number;
    lng: number;
    recordedAt: string;
  } | null;
}

export interface DailyRow {
  driver: { id: string; fullName: string };
  zoneName: string;
  delivered: number;
  hoursWorkedHours: number;
  alertCountOpen: number;
}
