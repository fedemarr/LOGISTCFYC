import { Stack } from "expo-router";
import { useSyncEngine } from "../../src/hooks/useSyncEngine";
import { useDriverTracking } from "../../src/hooks/useDriverTracking";
import { usePushRegistration } from "../../src/hooks/usePushRegistration";
import { colors } from "../../src/theme/tokens";

/**
 * Shell autenticado del chofer. `useSyncEngine()` acá arriba mantiene el
 * motor de sync corriendo (reconexión + timer) mientras cualquier
 * pantalla de `(driver)` está activa — no hace falta montarlo en cada
 * pantalla individual. `useDriverTracking()` (FASE 11, §10) arranca y
 * detiene el tracking de GPS según el estado de la ruta local.
 * `usePushRegistration()` (FASE 12 §5) registra el token de push contra
 * el backend y lo da de baja al desloguear.
 */
export default function DriverLayout() {
  useSyncEngine();
  useDriverTracking();
  usePushRegistration();

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
    />
  );
}
