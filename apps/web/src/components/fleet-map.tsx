"use client";

import * as React from "react";
import dynamic from "next/dynamic";

export interface MapZone {
  id: string;
  name: string;
  colorHex: string;
  centerLat: number;
  centerLng: number;
  radiusM: number;
}

export interface MapDriver {
  id: string;
  fullName: string;
  lat: number;
  lng: number;
  outside: boolean;
}

/**
 * Mapa Leaflet para el monitoreo live. Se carga dinámicamente (ssr:false)
 * porque Leaflet necesita el `window` del navegador — en el server Next lo
 * importaría y rompería el build.
 */
const LeafletMap = dynamic(() => import("./leaflet-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full p-6 text-sm">Cargando mapa…</div>,
});

export function FleetMap({
  zones,
  drivers,
  className,
}: {
  zones: MapZone[];
  drivers: MapDriver[];
  className?: string;
}) {
  return (
    <div className={className}>
      <LeafletMap zones={zones} drivers={drivers} />
    </div>
  );
}
