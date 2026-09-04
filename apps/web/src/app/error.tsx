"use client";

import * as React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ERROR BOUNDARY GLOBAL (FYM) — hasta ahora no había ninguno: un error de
 * cliente sin capturar (ej. una foto que el navegador no puede procesar)
 * tiraba la pantalla genérica de Next.js "Application error: a
 * client-side exception has occurred", sin forma de recuperarse más que
 * recargar a mano — reportado por Fede en la PWA del chofer, al marcar un
 * pedido entregado. Este boundary cubre TODA la app (layout raíz) y
 * ofrece "Reintentar" (`reset()`, vuelve a renderizar sin perder la
 * sesión guardada en localStorage) en vez de una pantalla muerta.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Sin Sentry configurado (DSN vacío), esto es lo único que queda de rastro.
    console.error("[error boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <AlertTriangle className="text-destructive size-10" />
      <div>
        <p className="font-medium">Algo salió mal</p>
        <p className="text-text-muted mt-1 text-sm">
          Pasó un error inesperado. Probá de nuevo — si sigue pasando, avisá qué estabas
          haciendo cuando pasó.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => reset()}>
          <RotateCw className="size-4" /> Reintentar
        </Button>
        <Button variant="outline" onClick={() => window.location.assign("/")}>
          Ir al inicio
        </Button>
      </div>
    </div>
  );
}
