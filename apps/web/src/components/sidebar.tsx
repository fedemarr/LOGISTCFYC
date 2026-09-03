"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@fym/shared";
import {
  AlertTriangle,
  BarChart3,
  Layers,
  LayoutDashboard,
  MapPinned,
  Radio,
  ShoppingBag,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Navegación del panel FYM (control de choferes), filtrada por rol.
 * - Inicio: KPIs del día.
 * - Monitoreo: mapa con choferes en vivo (última posición + geocerca).
 * - Choferes: alta/QR del chofer.
 * - Zonas: CRUD de geocercas.
 * - Alertas: cola de alertas de geocerca (llamar al chofer).
 * - Métricas: resumen diario por chofer.
 * - Pedidos: sincronización con Tienda Nube (pedido de un cliente,
 *   03/09/2026) — ver PROMPT-ALERTAS-FINANZAS.md.
 * - Usuarios: admin (alta de usuarios del panel y choferes).
 */
const NAV_ITEMS: {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}[] = [
  {
    href: "/",
    label: "Inicio",
    icon: LayoutDashboard,
    roles: ["admin", "dispatcher", "warehouse", "driver"],
  },
  {
    href: "/monitoreo",
    label: "Monitoreo",
    icon: Radio,
    roles: ["admin", "dispatcher"],
  },
  {
    href: "/choferes",
    label: "Choferes",
    icon: Truck,
    roles: ["admin", "dispatcher"],
  },
  {
    href: "/zonas",
    label: "Zonas",
    icon: MapPinned,
    roles: ["admin", "dispatcher"],
  },
  {
    href: "/alertas",
    label: "Alertas",
    icon: AlertTriangle,
    roles: ["admin", "dispatcher"],
  },
  {
    href: "/metricas",
    label: "Métricas",
    icon: BarChart3,
    roles: ["admin", "dispatcher", "warehouse"],
  },
  {
    href: "/pedidos",
    label: "Pedidos",
    icon: ShoppingBag,
    roles: ["admin", "dispatcher", "warehouse"],
  },
  {
    href: "/usuarios",
    label: "Usuarios",
    icon: Users,
    roles: ["admin"],
  },
  {
    href: "/chofer",
    label: "App del chofer",
    icon: Layers,
    roles: ["admin", "dispatcher"],
  },
];

export function SidebarNav({
  roles,
  onNavigate,
  className,
}: {
  roles: readonly Role[];
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) =>
    item.roles.some((r) => (roles as readonly string[]).includes(r)),
  );

  return (
    <nav className={cn("flex flex-col gap-1 p-3", className)}>
      {items.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "focus-visible:ring-3 focus-visible:ring-ring/40 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors",
              active
                ? "bg-surface-3 text-text"
                : "text-text-muted hover:bg-muted hover:text-text",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
