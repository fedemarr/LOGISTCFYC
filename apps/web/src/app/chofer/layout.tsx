import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "FYM — App del chofer",
  description: "Turnos, avances y GPS en vivo",
};

// Next.js 14+ separó `viewport` de `metadata` en su propio export — meterlo
// dentro de `metadata` compila pero tira warning en build y lo ignora.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

/**
 * Shell mobile-first de la PWA del chofer. Fuera del route group `(panel)`,
 * sin sidebar ni login del panel: la autenticación es el QR.
 */
export default function ChoferLayout({ children }: { children: ReactNode }) {
  return (
    <main className="bg-background mx-auto flex min-h-dvh w-full max-w-md flex-col p-4">
      <Toaster>{children}</Toaster>
    </main>
  );
}
