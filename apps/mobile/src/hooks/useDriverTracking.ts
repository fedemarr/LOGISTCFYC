import { useEffect, useRef } from "react";
import { useSQLiteContext } from "expo-sqlite";
import * as Location from "expo-location";
import {
  adaptiveTracking,
  startBackgroundTracking,
  stopBackgroundTracking,
} from "../lib/tracking";

const POLL_STATUS_MS = 5_000;

/**
 * Orquesta el tracking (§10) según el estado de la ruta local: cuando la
 * ruta pasa a IN_TRANSIT arranca el timer adaptativo (primer plano, solo
 * necesita permiso de foreground) y, si además hay permiso de background,
 * el tracking por distancia. Se monta en el layout de `(driver)` así
 * cubre cualquier pantalla; pollea el estado local cada 5 s (barato: es
 * una fila en SQLite, no una red de por medio).
 */
export function useDriverTracking(): void {
  const db = useSQLiteContext();
  const startedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const check = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const route = await db.getFirstAsync<{ status: string }>(
          `SELECT status FROM local_route LIMIT 1`,
        );
        const active = route?.status === "IN_TRANSIT";

        if (active && !startedRef.current) {
          const foreground = await Location.getForegroundPermissionsAsync();
          if (foreground.granted) {
            startedRef.current = true;
            adaptiveTracking.start(db);
          }
          const background = await Location.getBackgroundPermissionsAsync();
          if (background.granted) {
            await startBackgroundTracking().catch(() => undefined);
          }
        } else if (!active && startedRef.current) {
          startedRef.current = false;
          adaptiveTracking.stop();
          await stopBackgroundTracking().catch(() => undefined);
        }
      } catch {
        // Sin permisos o sin base — reintenta el próximo ciclo.
      }
    };

    void check();
    const interval = setInterval(() => void check(), POLL_STATUS_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      adaptiveTracking.stop();
      void stopBackgroundTracking().catch(() => undefined);
    };
  }, [db]);
}
