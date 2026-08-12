"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { api, type MeResponse } from "@/lib/api/client";
import { createSupabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Inicio del panel: tarjetas con los conteos de cada módulo (FASE 4).
 * Usa el `meta.total` de cada listado (pageSize=1) en vez de un endpoint
 * de stats dedicado.
 */
export default function DashboardPage() {
  const router = useRouter();
  const [orgName, setOrgName] = React.useState<string | null>(null);
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [counts, setCounts] = React.useState<Record<string, number | null>>({});
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const me = await api.get<MeResponse>("/api/auth/me");
        if (cancelled) return;
        setOrgName(me.orgName);
        setIsAdmin(me.user.roles.includes("admin"));

        const targets: [string, string][] = [
          ["packages", "/api/packages?pageSize=1"],
          ["clients", "/api/clients?pageSize=1"],
          ["containers", "/api/containers?pageSize=1"],
          ["vehicles", "/api/vehicles?pageSize=1"],
          ...(me.user.roles.includes("admin")
            ? ([["users", "/api/users?pageSize=1"]] as [string, string][])
            : []),
        ];
        const results = await Promise.allSettled(
          targets.map(async ([key, path]) => {
            const data = await api.get<{ meta: { total: number } }>(path);
            return [key, data.meta.total] as const;
          }),
        );
        if (cancelled) return;
        const next: Record<string, number | null> = {};
        for (const key of targets.map((t) => t[0])) next[key] = null;
        for (const result of results) {
          if (result.status === "fulfilled") {
            const [key, total] = result.value;
            next[key] = total;
          }
        }
        setCounts(next);
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

  const cards: { key: string; label: string; href: string }[] = [
    { key: "packages", label: "Paquetes", href: "/paquetes" },
    { key: "clients", label: "Clientes", href: "/clientes" },
    { key: "containers", label: "Contenedores", href: "/contenedores" },
    { key: "vehicles", label: "Vehículos", href: "/vehiculos" },
    ...(isAdmin ? [{ key: "users", label: "Usuarios", href: "/usuarios" }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {loading ? <Skeleton className="h-7 w-56" /> : `Hola, bienvenido`}
        </h1>
        <p className="text-text-muted mt-1 text-sm">
          {orgName ?? "Panel de Operaciones"} — vista general del sistema.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            className="focus-visible:ring-3 focus-visible:ring-ring/40 group rounded-lg outline-none"
          >
            <Card className="group-hover:border-primary/40 transition-colors">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardDescription>{card.label}</CardDescription>
                  <ArrowUpRight className="text-text-muted size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
                <CardTitle className="text-3xl tabular-nums">
                  {loading ? (
                    <Skeleton className="h-8 w-14" />
                  ) : (
                    (counts[card.key] ?? "—")
                  )}
                </CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
