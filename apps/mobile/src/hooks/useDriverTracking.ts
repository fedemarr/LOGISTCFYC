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
 * Orquesta el tracking (§10 + FASE A) según el estado de la ruta local:
 * cuando la ruta está ACTIVA (desde ASSIGNED, o sea desde que el chofer
 * confirma la custodia) arranca el timer adaptativo (primer plano, solo
 * necesita permiso de foreground) y, si además hay permiso de background,
 * el tracking por distancia. Se monta en el layout de `(driver)` así
 * cubre cualquier pantalla; pollea el estado local cada 5 s (barato: es
 * una fila en SQLite, no una red de por medio).
 */
export function useDriverTracking(): void {
  const db = useSQLiteContext();
  const startedRef = useRef(false);

  const isActive = (status: string | null | undefined): boolean =>
    status != null &&
    status !== "APPROVED" &&
    status !== "COMPLETED" &&
    status !== "CANCELLED";

  useEffect(() => {
    let cancelled = false;

    const check = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const route = await db.getFirstAsync<{ status: string }>(
          `SELECT status FROM local_route LIMIT 1`,
        );
        const active = isActive(route?.status);

        if (active && !startedRef.current) {
          // PEDIR el permiso acá, no solo revisar si ya está — antes esto
          // solo leía `getForegroundPermissionsAsync()`, así que si el
          // chofer nunca lo había concedido por otro camino, el tracking
          // jamás arrancaba y la ruta nunca aparecía con ubicación en
          // `/monitoreo` del panel web, aunque la ruta ya figurara como
          // ACTIVA ahí (pedido de Fede: "apenas escanee ya debería
          // aparecer"). La pantalla "Ruta" ya lo pide apenas abre la app,
          // pero no hay que depender de ese orden — acá se vuelve a pedir
          // si todavía no está concedido, sin bloquear el resto del check.
          const foreground = await Location.requestForegroundPermissionsAsync();
          if (foreground.granted) {
            startedRef.current = true;
            adaptiveTracking.start(db);
          }
          // El background sigue solo CHEQUEANDO (no pidiendo): en Android
          // reciente el permiso "Permitir todo el tiempo" no se puede
          // disparar con un simple prompt del sistema como el de
          // foreground — necesita su propio flujo de UX (explicar antes
          // de pedir, mandar a Config si hace falta) que no se puede
          // resolver bien sin probarlo en un dispositivo real. Con
          // foreground activo, el chofer YA aparece en el mapa de
          // monitoreo mientras tenga la app abierta — el background es
          // una mejora para cuando la pantalla está bloqueada, no un
          // bloqueante para que la funcionalidad básica ande.
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
