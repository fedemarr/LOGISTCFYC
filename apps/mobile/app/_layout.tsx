import * as React from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Sentry from "@sentry/react-native";
import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
} from "@expo-google-fonts/archivo";
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from "@expo-google-fonts/jetbrains-mono";
import { SessionProvider, useSession } from "../src/context/session";
import { LocalDbProvider } from "../src/lib/db/provider";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { colors } from "../src/theme/tokens";

void SplashScreen.preventAutoHideAsync();

/**
 * FASE 13 — Sentry mobile. Se activa únicamente si el DSN está en el
 * entorno como `EXPO_PUBLIC_SENTRY_DSN` (las variables EXPO_PUBLIC_* son
 * las únicas que se inlinean en el bundle). Desactivado en development
 * para no contaminar el dashboard con errores de dev.
 */
if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.2,
    enabled: !__DEV__,
  });
}

/**
 * Layout raíz — carga fuentes + sesión + SQLite ANTES de mostrar
 * cualquier pantalla (splash se mantiene hasta que todo está listo, así
 * no hay flash de contenido sin fuentes o de "no logueado" mientras
 * Supabase todavía está resolviendo la sesión guardada).
 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });

  React.useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <LocalDbProvider>
          <SessionProvider>
            <StatusBar style="light" />
            <RootNavigator />
          </SessionProvider>
        </LocalDbProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

/**
 * Gateo de rutas por sesión (patrón recomendado de Expo Router,
 * `Stack.Protected`). Deep-linkear a una pantalla del chofer sin sesión
 * redirige sola a `/login`; loguearse redirige a `(driver)`.
 */
function RootNavigator() {
  const { session, isLoading } = useSession();
  if (isLoading) return null;

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
    >
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(driver)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" />
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
    </Stack>
  );
}
