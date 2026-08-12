import { Stack } from "expo-router";
import { useSyncEngine } from "../../src/hooks/useSyncEngine";
import { colors } from "../../src/theme/tokens";

/**
 * Shell autenticado del chofer. `useSyncEngine()` acá arriba mantiene el
 * motor de sync corriendo (reconexión + timer) mientras cualquier
 * pantalla de `(driver)` está activa — no hace falta montarlo en cada
 * pantalla individual.
 */
export default function DriverLayout() {
  useSyncEngine();

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
    />
  );
}
