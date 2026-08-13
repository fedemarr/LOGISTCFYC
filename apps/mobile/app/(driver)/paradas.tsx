import * as React from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import * as Haptics from "expo-haptics";
import { useSyncStore } from "../../src/lib/sync/store";
import {
  getLocalRoute,
  reorderStopsLocally,
  setLocalRouteStatus,
} from "../../src/lib/db/routes";
import type { LocalStopRow } from "../../src/lib/db/schema";
import { enqueueRouteFinished, enqueueStopsReordered } from "../../src/lib/delivery";
import { colors, fonts, radius, spacing, touch } from "../../src/theme/tokens";

const STOP_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  ARRIVED: "Llegó",
  COMPLETED: "Entregado",
  FAILED: "Problema",
  SKIPPED: "Salteada",
};

/**
 * Mis paradas (§9.5, §9.8, §9.9) — el chofer llega acá desde Inicio una
 * vez que la ruta está en la calle:
 *
 *   - Lista completa de paradas con estado y progreso del día.
 *   - Reorden manual (§9.8): botones ↑/↓ por parada; cada movimiento
 *     re-secuencia local e encola STOPS_REORDERED (offline-safe, el
 *     servidor valida que la lista nueva sea exactamente la misma).
 *   - "Finalizar ruta" (§9.9): encola ROUTE_FINISHED y marca la ruta
 *     local COMPLETED (el tracking se apaga solo, ver useDriverTracking).
 *   - Tap en una parada → pantalla de la parada (entrega/incidencia).
 */
export default function ParadasScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { pendingCount, lastError } = useSyncStore();
  const [routeInfo, setRouteInfo] = React.useState<
    | { routeId: string; routeNumber: number; status: string; stops: LocalStopRow[] }
    | null
    | undefined
  >(undefined);
  const [finishing, setFinishing] = React.useState(false);

  const load = React.useCallback(async () => {
    const result = await getLocalRoute(db);
    setRouteInfo(
      result
        ? {
            routeId: result.route.id,
            routeNumber: result.route.route_number,
            status: result.route.status,
            stops: result.stops,
          }
        : null,
    );
  }, [db]);

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load]),
  );

  async function moveStop(stopId: string, direction: -1 | 1): Promise<void> {
    if (!routeInfo) return;
    const index = routeInfo.stops.findIndex((s) => s.id === stopId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= routeInfo.stops.length) return;

    await Haptics.selectionAsync();
    const next = [...routeInfo.stops];
    const moved = next.splice(index, 1)[0]!;
    next.splice(target, 0, moved);

    const orderedIds = next.map((s) => s.id);
    await reorderStopsLocally(db, orderedIds);
    await enqueueStopsReordered(db, routeInfo.routeId, orderedIds);
    setRouteInfo({ ...routeInfo, stops: next });
  }

  async function handleFinishRoute(): Promise<void> {
    if (!routeInfo || finishing) return;
    setFinishing(true);
    try {
      await enqueueRouteFinished(db, routeInfo.routeId);
      await setLocalRouteStatus(db, "COMPLETED");
      await load();
    } finally {
      setFinishing(false);
    }
  }

  if (routeInfo === undefined) {
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

  const completed = (routeInfo?.stops ?? []).filter(
    (s) => s.status === "COMPLETED",
  ).length;
  const isInTransit = routeInfo?.status === "IN_TRANSIT";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
    >
      <View style={{ gap: spacing.xs }}>
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 22, color: colors.text }}>
          {routeInfo
            ? `RUTA ${String(routeInfo.routeNumber).padStart(3, "0")}`
            : "SIN RUTA"}
        </Text>
        <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.muted }}>
          {completed} de {routeInfo?.stops.length ?? 0} paradas entregadas
        </Text>
      </View>

      {pendingCount > 0 && (
        <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.warning }}>
          {pendingCount} acción(es) pendientes de sincronizar
        </Text>
      )}
      {lastError && (
        <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.warning }}>
          {lastError}
        </Text>
      )}

      {!routeInfo && (
        <View style={cardStyle}>
          <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.muted }}>
            Descargá tu ruta desde Inicio antes de ver paradas.
          </Text>
        </View>
      )}

      {routeInfo &&
        routeInfo.stops.map((stop) => {
          const completed = stop.status === "COMPLETED" || stop.status === "FAILED";
          return (
            <View key={stop.id} style={cardStyle}>
              <TouchableOpacity
                onPress={() => router.push(`/parada/${stop.id}`)}
                style={{ flex: 1, gap: spacing.xs }}
              >
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
                >
                  <Text
                    style={{
                      fontFamily: fonts.monoBold,
                      fontSize: 15,
                      color: colors.text,
                    }}
                  >
                    {String(stop.sequence).padStart(2, "0")} · BULTO{" "}
                    {stop.bulk_number ?? "-"}
                  </Text>
                  <View
                    style={{
                      backgroundColor: statusColor(stop.status),
                      borderRadius: radius.sm,
                      paddingHorizontal: spacing.sm,
                      paddingVertical: 2,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: fonts.sansSemibold,
                        fontSize: 11,
                        color: colors.bg,
                      }}
                    >
                      {STOP_LABELS[stop.status] ?? stop.status}
                    </Text>
                  </View>
                </View>
                <Text
                  style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.text }}
                >
                  {stop.recipient_name ?? "Sin nombre de destinatario"}
                </Text>
                <Text
                  style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.muted }}
                >
                  {stop.raw_address_text ?? "Sin dirección"}
                </Text>
              </TouchableOpacity>

              {isInTransit && !completed && (
                <View style={{ flexDirection: "column", gap: spacing.xs }}>
                  <TouchableOpacity
                    onPress={() => void moveStop(stop.id, -1)}
                    disabled={stop.sequence <= 1}
                    style={[reorderButton, { opacity: stop.sequence <= 1 ? 0.3 : 1 }]}
                  >
                    <Text style={reorderGlyph}>↑</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => void moveStop(stop.id, 1)}
                    disabled={stop.sequence >= routeInfo.stops.length}
                    style={[
                      reorderButton,
                      { opacity: stop.sequence >= routeInfo.stops.length ? 0.3 : 1 },
                    ]}
                  >
                    <Text style={reorderGlyph}>↓</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

      {routeInfo && isInTransit && (
        <TouchableOpacity
          onPress={() => void handleFinishRoute()}
          disabled={finishing}
          style={{
            height: touch.primaryButton,
            borderRadius: radius.md,
            backgroundColor: colors.danger,
            alignItems: "center",
            justifyContent: "center",
            opacity: finishing ? 0.6 : 1,
          }}
        >
          {finishing ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}>
              FINALIZAR RUTA
            </Text>
          )}
        </TouchableOpacity>
      )}

      <TouchableOpacity
        onPress={() => router.push("/inicio")}
        style={{
          minHeight: touch.minTarget,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.muted }}>
          Volver a Inicio
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "COMPLETED":
      return colors.success;
    case "FAILED":
      return colors.danger;
    case "ARRIVED":
      return colors.active;
    default:
      return colors.pending;
  }
}

const cardStyle = {
  backgroundColor: colors.surface2,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.border,
  padding: spacing.lg,
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: spacing.md,
};

const reorderButton = {
  width: 40,
  height: 40,
  borderRadius: radius.md,
  backgroundColor: colors.surface3,
  borderWidth: 1,
  borderColor: colors.border,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};

const reorderGlyph = {
  fontFamily: fonts.sansBold,
  fontSize: 18,
  color: colors.text,
};
