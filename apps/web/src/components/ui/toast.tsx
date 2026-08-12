"use client";

import * as React from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Toast mínimo (FASE 4 — "Success (feedback inmediato)" de §13). Un
 * contexto global + `<Toaster/>` montado en el app shell; los componentes
 * llaman `useToast().toast({ title, variant })`.
 */
type ToastVariant = "success" | "error";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastApi {
  toast: (input: { title: string; description?: string; variant?: ToastVariant }) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <Toaster/>");
  return ctx;
}

export function Toaster() {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const idRef = React.useRef(0);

  const toast = React.useCallback<ToastApi["toast"]>((input) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, variant: "success", ...input }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            data-slot="toast"
            className={cn(
              "bg-surface text-text pointer-events-auto flex w-80 items-start gap-2.5 rounded-lg border p-3 shadow-md",
              t.variant === "success"
                ? "border-status-success/30"
                : "border-status-danger/30",
            )}
            role="status"
          >
            {t.variant === "success" ? (
              <CheckCircle2 className="text-status-success mt-0.5 size-4 shrink-0" />
            ) : (
              <AlertCircle className="text-status-danger mt-0.5 size-4 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug">{t.title}</p>
              {t.description && (
                <p className="text-text-muted mt-0.5 text-sm leading-snug">
                  {t.description}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
