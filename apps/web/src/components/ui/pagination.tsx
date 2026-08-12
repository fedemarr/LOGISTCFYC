import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import type { PaginationMeta } from "@/lib/api/client";

/**
 * Paginación offset estándar (FASE 4). Envuelve el `meta` de la API:
 * botones anterior/siguiente y páginas cuando hay espacio.
 */
function Pagination({
  meta,
  onPageChange,
  className,
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const { page, pages } = meta;
  if (pages <= 1) return null;

  const pagesToShow = Array.from(new Set([1, page, pages])).sort((a, b) => a - b);

  return (
    <nav aria-label="Paginación" className={cn("flex items-center gap-1", className)}>
      <Button
        variant="outline"
        size="icon-sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Página anterior"
      >
        <ChevronLeft className="size-4" />
      </Button>

      <div className="hidden items-center gap-1 sm:flex">
        {pagesToShow.map((p, i) => {
          const prev = pagesToShow[i - 1];
          const gap = prev ? p - prev : 0;
          return (
            <React.Fragment key={p}>
              {gap > 1 && <span className="text-text-muted px-1 text-sm">…</span>}
              <Button
                variant={p === page ? "default" : "ghost"}
                size="icon-sm"
                onClick={() => onPageChange(p)}
              >
                {p}
              </Button>
            </React.Fragment>
          );
        })}
      </div>

      <span className="text-text-muted px-2 text-sm sm:hidden">
        {page} / {pages}
      </span>

      <Button
        variant="outline"
        size="icon-sm"
        disabled={page >= pages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Página siguiente"
      >
        <ChevronRight className="size-4" />
      </Button>
    </nav>
  );
}

export { Pagination };
