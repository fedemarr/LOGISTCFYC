import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Menú de acciones por fila (Base UI `Menu`). Se dispara con el botón
 * "⋯" de cada fila de las tablas de los CRUD.
 */
function DropdownMenuContent({
  className,
  children,
  align = "end",
  sideOffset = 4,
}: {
  className?: string;
  children?: React.ReactNode;
  align?: "start" | "center" | "end";
  sideOffset?: number;
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner align={align} sideOffset={sideOffset}>
        <Menu.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "bg-surface text-text origin-(var(--transform-origin)) z-50 min-w-36 overflow-hidden rounded-lg border p-1 shadow-md outline-none duration-200 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
            className,
          )}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "text-text data-[highlighted]:bg-muted data-[highlighted]:text-text relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:outline-none",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Menu.Separator>) {
  return (
    <Menu.Separator
      data-slot="dropdown-menu-separator"
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...props}
    />
  );
}

function DropdownMenuTrigger({
  className,
  ...props
}: React.ComponentProps<typeof Menu.Trigger>) {
  return (
    <Menu.Trigger
      data-slot="dropdown-menu-trigger"
      className={cn(
        "text-text-muted hover:bg-muted hover:text-text focus-visible:ring-3 focus-visible:ring-ring/40 rounded-md p-1.5 outline-none",
        className,
      )}
      {...props}
    >
      <MoreHorizontal className="size-4" />
    </Menu.Trigger>
  );
}

const DropdownMenuRoot = Menu.Root;

export {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
};
