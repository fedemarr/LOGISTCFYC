"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { api, type MeResponse } from "@/lib/api/client";
import { createSupabaseClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarNav } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Toaster } from "@/components/ui/toast";

/**
 * Shell autenticado del panel (FASE 4). Verifica la sesión de Supabase
 * (localStorage), resuelve identidad+roles vía `/api/auth/me` y arma el
 * layout responsive: sidebar fija en desktop, drawer en mobile. Cualquier
 * fallo de sesión redirige a /login.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = React.useState<
    { status: "loading" } | { status: "ready"; me: MeResponse } | { status: "error" }
  >({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createSupabaseClient();
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        router.replace("/login");
        return;
      }
      try {
        const me = await api.get<MeResponse>("/api/auth/me");
        if (!cancelled) setState({ status: "ready", me });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const [mobileOpen, setMobileOpen] = React.useState(false);

  async function handleLogout() {
    await createSupabaseClient().auth.signOut();
    router.replace("/login");
  }

  if (state.status !== "ready") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        {state.status === "error" ? (
          <div className="text-sm">
            No se pudo verificar la sesión.{" "}
            <button
              className="text-primary underline"
              onClick={() => router.replace("/login")}
            >
              Volver a entrar
            </button>
          </div>
        ) : (
          <div className="flex w-full max-w-md flex-col gap-3 p-6">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        )}
      </div>
    );
  }

  const { me } = state;
  const initials = me.user.fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <Toaster>
      <div className="bg-bg text-text flex min-h-screen">
        {/* Sidebar desktop */}
        <aside className="bg-surface border-border sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r lg:flex">
          <Brand />
          <SidebarNav roles={me.user.roles} className="flex-1 overflow-y-auto" />
          <UserFooter
            name={me.user.fullName}
            org={me.orgName}
            initials={initials}
            onLogout={handleLogout}
          />
        </aside>

        {/* Drawer mobile */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setMobileOpen(false)}
              aria-hidden
            />
            <aside className="bg-surface absolute inset-y-0 left-0 flex w-72 flex-col shadow-lg">
              <div className="flex items-center justify-between p-3">
                <Brand />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Cerrar menú"
                >
                  <X className="size-4" />
                </Button>
              </div>
              <SidebarNav
                roles={me.user.roles}
                onNavigate={() => setMobileOpen(false)}
                className="flex-1 overflow-y-auto"
              />
              <UserFooter
                name={me.user.fullName}
                org={me.orgName}
                initials={initials}
                onLogout={handleLogout}
              />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar mobile */}
          <header className="border-border bg-[color:var(--bg)]/90 sticky top-0 z-40 flex items-center gap-2 border-b px-4 py-2 backdrop-blur lg:hidden">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menú"
            >
              <Menu className="size-4" />
            </Button>
            <span className="text-sm font-semibold">FYM</span>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </Toaster>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <div
        className="size-[22px] shrink-0 rounded-[5px]"
        style={{ background: "linear-gradient(135deg, var(--route-1), var(--route-2))" }}
        aria-hidden
      />
      <span className="text-sm font-bold tracking-tight">FYM</span>
    </div>
  );
}

function UserFooter({
  name,
  org,
  initials,
  onLogout,
}: {
  name: string;
  org: string | null;
  initials: string;
  onLogout: () => void;
}) {
  return (
    <div className="border-border flex items-center gap-2 border-t p-3">
      <div className="bg-muted text-text-muted flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        {org && <p className="text-text-muted truncate text-xs">{org}</p>}
      </div>
      <ThemeToggle />
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onLogout}
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
      >
        <LogOut className="size-4" />
      </Button>
    </div>
  );
}
