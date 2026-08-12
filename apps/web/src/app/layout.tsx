import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

/**
 * Tipografía (PROMPT-FRONTEND-V2 §2): Archivo para toda la interfaz,
 * JetBrains Mono para todo dato operativo (códigos, bultos, km, horas —
 * cifras tabulares, glifos que no confunden `0` con `O`).
 */
const archivo = Archivo({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FYC — Panel de Operaciones",
  description: "Panel administrativo del sistema de logística de última milla",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${archivo.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
