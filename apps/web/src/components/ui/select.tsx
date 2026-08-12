import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Select nativo estilizado — suficiente para los CRUD del panel y sin la
 * complejidad de un combobox accesible de Base UI. Si FASE 5+ necesita
 * búsqueda/creación inline, se migra a `@base-ui/react/combobox`.
 */
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          "border-input bg-background text-text placeholder:text-text-muted/60 shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 h-9 w-full appearance-none rounded-lg border px-3 py-1 pr-8 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="text-text-muted pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2" />
    </div>
  );
}

export { Select };
