import * as React from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { getLocalRoute } from "../../src/lib/db/routes";
import type { LocalRouteRow, LocalStopRow } from "../../src/lib/db/schema";
import { RouteMapView } from "../../src/components/RouteMapView";
import { colors, fonts, radius, spacing, touch } from "../../src/theme/tokens";

function formatKm(distanceM: number | null): string {
  if (distanceM == null) return "—";
  return (distanceM / 1000).toFixed(1);
}

function formatDuration(durationS: number | null): string {
  if (durationS == null) return "—";
  const totalMin = Math.round(durationS / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/**
 * Pantalla de transición entre "escanear ruta" y "custodia y carga"
 * (pedido de Fede): apenas se escanea el QR de la ruta y se abre el acta
 * de custodia, en vez de tirar al chofer directo al conteo bulto por
 * bulto, se le muestra primero un mensaje amigable con el mapa ya
 * cargado ("acá está tu ruta, esto es lo que te toca hoy") — igual que
 * los puntos que ya se ven armados en Ruteo (panel web), pero en el
 * celular.
 *
 * NO se salta el conteo de bultos (§9.3, control real contra faltantes)
 * — solo se antepone esta pantalla antes de pedirlo, sigue siendo un
 * paso más, no reemplaza al de custodia.
 */
export default function RutaEncontradaScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [data, setData] = React.useState<
    { route: LocalRouteRow; stops: LocalStopRow[] } | null | undefined
  >(undefined);

  useFocusEffect(
    React.useCallback(() => {
      void getLocalRoute(db).then(setData);
    }, [db]),
  );

  if (data === undefined) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  if (!data) {
    // No debería pasar (recién se descargó la ruta al escanear), pero si
    // por lo que sea no hay nada local, seguimos igual al flujo de
    // custodia en vez de dejar al chofer varado en una pantalla vacía.
    router.replace("/custodia");
    return null;
  }

  const { route, stops } = data;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: spacing.lg, gap: spacing.xs }}>
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 24, color: colors.text }}>
          ¡Tenemos la mejor ruta para vos!
        </Text>
        <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.muted }}>
          RUTA {String(route.route_number).padStart(3, "0")} · {stops.length}{" "}
          {stops.length === 1 ? "parada" : "paradas"} ·{" "}
          {formatKm(route.planned_distance_m)} km ·{" "}
          {formatDuration(route.planned_duration_s)}
        </Text>
      </View>

      <View style={{ flex: 1, paddingHorizontal: spacing.lg }}>
        <RouteMapView
          stops={stops
            .filter((s) => s.lat != null && s.lng != null)
            .map((s) => ({
              id: s.id,
              sequence: s.sequence,
              lat: s.lat!,
              lng: s.lng!,
              status: s.status,
            }))}
          fill
        />
      </View>

      <View style={{ padding: spacing.lg }}>
        <TouchableOpacity
          onPress={() => router.replace("/custodia")}
          style={{
            height: touch.primaryButton,
            borderRadius: radius.md,
            backgroundColor: colors.text,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}>
            Continuar — contar los bultos
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
