"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { DeliveryPoint } from "./delivery-points-map-inner";

export type { DeliveryPoint };

/** Se carga dinámicamente (ssr:false) porque Leaflet necesita `window` —
 * mismo motivo que `fleet-map.tsx` del panel. */
const DeliveryPointsMapInner = dynamic(() => import("./delivery-points-map-inner"), {
  ssr: false,
  loading: () => <div className="h-full w-full p-6 text-sm">Cargando mapa…</div>,
});

export function DeliveryPointsMap({
  points,
  className,
}: {
  points: DeliveryPoint[];
  className?: string;
}) {
  return (
    <div className={className}>
      <DeliveryPointsMapInner points={points} />
    </div>
  );
}
