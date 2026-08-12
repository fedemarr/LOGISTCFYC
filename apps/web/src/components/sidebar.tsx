"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@fyc/shared";
import {
  Boxes,
  Building2,
  LayoutDashboard,
  Package,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Navegación del panel filtrada por rol (FASE 4 — sidebar por rol).
 * Fuente de la verdad de permisos: la matriz de PROMPT-MAESTRO §3
 * (admin todo; dispatcher/warehouse staff; driver solo su ruta).
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
    href: "/paquetes",
    label: "Paquetes",
    icon: Package,
    roles: ["admin", "dispatcher", "warehouse", "driver"],
  },
  {
    href: "/clientes",
    label: "Clientes",
    icon: Building2,
    roles: ["admin", "dispatcher", "warehouse"],
  },
  {
    href: "/contenedores",
    label: "Contenedores",
    icon: Boxes,
    roles: ["admin", "dispatcher", "warehouse"],
  },
  {
    href: "/vehiculos",
    label: "Vehículos",
    icon: Truck,
    roles: ["admin", "dispatcher", "warehouse"],
  },
  { href: "/usuarios", label: "Usuarios", icon: Users, roles: ["admin"] },
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
                ? "bg-primary/10 text-primary"
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
