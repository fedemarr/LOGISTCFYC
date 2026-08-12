import * as React from "react";
import { Inbox, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

/**
 * Estados obligatorios de toda vista (§13): Empty (con acción sugerida)
 * y Error (con reintento). El loading se resuelve con skeletons en cada
 * página, no con spinners.
 */

export function TableSkeleton({
  columns = 4,
  rows = 5,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: columns }).map((__, j) => (
            <Skeleton key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="bg-muted/60 text-text-muted rounded-full p-3">
        <Inbox className="size-6" />
      </div>
      <p className="mt-2 text-sm font-medium">{title}</p>
      {description && <p className="text-text-muted max-w-sm text-sm">{description}</p>}
      {actionLabel && onAction && (
        <Button variant="outline" className="mt-3" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export function ErrorState({
  title = "No se pudo cargar",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="bg-status-danger/10 text-status-danger rounded-full p-3">
        <TriangleAlert className="size-6" />
      </div>
      <p className="mt-2 text-sm font-medium">{title}</p>
      {description && <p className="text-text-muted max-w-sm text-sm">{description}</p>}
      {onRetry && (
        <Button variant="outline" className="mt-3" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          Reintentar
        </Button>
      )}
    </div>
  );
}
