import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { colors } from "../../../src/theme/tokens";

/**
 * Navegación principal del chofer (pedido explícito de Fede, no está en
 * PROMPT-MAESTRO original): tabs abajo — Ruta / Notificaciones / Más —
 * con mapa como pantalla principal, en vez de una lista pelada. Paleta
 * sigue siendo la oscura de FYC (§13: pantalla sucia, sol, guantes) —
 * confirmado explícitamente NO copiar el tema claro/amarillo de la app
 * de referencia, solo el patrón de navegación.
 *
 * Grupo `(tabs)` anidado adentro de `(driver)`: las pantallas de flujo
 * (custodia, escanear, parada/[stopId], etc.) siguen viviendo como
 * screens del `Stack` de `(driver)/_layout.tsx`, por ENCIMA de los tabs
 * — se abren a pantalla completa sin la barra de abajo, patrón estándar
 * de Expo Router para no mezclar detalle con navegación principal.
 */
export default function DriverTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface2,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="ruta"
        options={{
          title: "Ruta",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="notificaciones"
        options={{
          title: "Notificaciones",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="mas"
        options={{
          title: "Más",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="menu-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
