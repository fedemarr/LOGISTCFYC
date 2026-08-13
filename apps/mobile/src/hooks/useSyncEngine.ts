import { useCallback, useEffect, useRef } from "react";
import { useSQLiteContext } from "expo-sqlite";
import NetInfo from "@react-native-community/netinfo";
import { getDeviceId } from "../lib/device";
import { getPendingCount } from "../lib/sync/outbox";
import { flush } from "../lib/sync/engine";
import { flushMedia } from "../lib/media";
import { useSyncStore } from "../lib/sync/store";

const PERIODIC_FLUSH_MS = 30_000;

/**
 * Motor de sync en background (foreground de la app — §12 en FASE 7 no
 * incluye sync con la app cerrada, eso es una mejora de FASE 11 con
 * `expo-task-manager`). Dos disparadores: reconexión de red, y un timer
 * cada 30s mientras la app está abierta. Serializado con un ref (no
 * estado) para que dos disparos simultáneos nunca manden el mismo lote
 * dos veces en paralelo.
 *
 * FASE 10 suma `flushMedia`: primero se suben las fotos pendientes a
 * Storage y recién después se sincroniza el outbox (así la foto adjunta
 * vía DELIVERY_PHOTO_ATTACH viaja en el mismo ciclo cuando puede).
 */
export function useSyncEngine(): void {
  const db = useSQLiteContext();
  const isFlushingRef = useRef(false);
  const { setOnline, setSyncing, setPendingCount, setError, setSyncedNow } =
    useSyncStore();

  const refreshPendingCount = useCallback(async () => {
    const count = await getPendingCount(db);
    setPendingCount(count);
  }, [db, setPendingCount]);

  const runFlush = useCallback(async () => {
    if (isFlushingRef.current) return;
    isFlushingRef.current = true;
    setSyncing(true);
    try {
      const deviceId = await getDeviceId();
      await flushMedia(db);
      const result = await flush(db, deviceId);
      if (result.failed > 0) {
        setError(`${result.failed} acción(es) no se pudieron sincronizar todavía`);
      } else {
        setSyncedNow();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "error de sincronización desconocido",
      );
    } finally {
      isFlushingRef.current = false;
      setSyncing(false);
      await refreshPendingCount();
    }
  }, [db, refreshPendingCount, setError, setSyncedNow, setSyncing]);

  // Conteo inicial al montar.
  useEffect(() => {
    void refreshPendingCount();
  }, [refreshPendingCount]);

  // Reconexión de red → sincronizar ya.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      setOnline(online);
      if (online) void runFlush();
    });
    return unsubscribe;
  }, [runFlush, setOnline]);

  // Timer periódico mientras la app está abierta.
  useEffect(() => {
    const interval = setInterval(() => void runFlush(), PERIODIC_FLUSH_MS);
    return () => clearInterval(interval);
  }, [runFlush]);
}
