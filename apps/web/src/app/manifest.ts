import type { MetadataRoute } from "next";

/**
 * Manifest PWA (FYM). La app del chofer se instala desde el navegador
 * (Android/Chrome/iOS Safari) y corre fullscreen como una app nativa.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FYM — Envíos por Milla",
    short_name: "FYM",
    description: "App de control del chofer: turnos, avances y GPS en vivo",
    start_url: "/chofer",
    display: "standalone",
    background_color: "#0b0f14",
    theme_color: "#0b0f14",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
