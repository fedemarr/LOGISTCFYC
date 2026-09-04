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

/** Pedido geocodificado de un turno en curso — pin en el mapa de
 * /monitoreo (pedido de Fede: "que aparezcan como los puntos en
 * monitoreo en el mapa"). */
export interface MapOrder {
  id: string;
  lat: number;
  lng: number;
  orderNumber: string;
  customerName: string | null;
  status: "PENDING" | "ASSIGNED" | "DELIVERED" | "FAILED" | "CANCELLED";
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
  orders,
  className,
}: {
  zones: MapZone[];
  drivers: MapDriver[];
  orders?: MapOrder[];
  className?: string;
}) {
  return (
    <div className={className}>
      <LeafletMap zones={zones} drivers={drivers} orders={orders ?? []} />
    </div>
  );
}
