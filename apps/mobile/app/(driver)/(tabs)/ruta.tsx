import * as React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useSyncStore } from "../../../src/lib/sync/store";
import {
  getLocalRoute,
  reorderStopsLocally,
  setLocalRouteStatus,
} from "../../../src/lib/db/routes";
import type { LocalStopRow } from "../../../src/lib/db/schema";
import { enqueueRouteFinished, enqueueStopsReordered } from "../../../src/lib/delivery";
import { RouteMapView } from "../../../src/components/RouteMapView";
import type { RouteMapUserLocation } from "../../../src/components/RouteMapView";
import { colors, fonts, radius, spacing, touch } from "../../../src/theme/tokens";

const STOP_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  ARRIVED: "Llegó",
  COMPLETED: "Entregado",
  FAILED: "Problema",
  SKIPPED: "Salteada",
};

/**
 * "Ruta" — tab principal del chofer (§9.5, §9.8, §9.9), fusiona lo que
 * antes eran dos pantallas separadas (Inicio + Mis paradas) en una sola,
 * con el mapa arriba (pedido explícito de Fede) en vez de una lista
 * pelada:
 *
 *   - Banner de conexión/sync + toggle "EN SERVICIO" (ex-Inicio).
 *   - Mapa con pines numerados por parada, coloreados por estado.
 *   - Lista completa debajo, con reorden manual (§9.8) y "Finalizar
 *     ruta" (§9.9) — misma lógica que tenía `paradas.tsx` antes.
 */
export default function RutaScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { isOnline, isSyncing, pendingCount, lastError } = useSyncStore();
  const [onService, setOnService] = React.useState(false);
  const [routeInfo, setRouteInfo] = React.useState<
    | { routeId: string; routeNumber: number; status: string; stops: LocalStopRow[] }
    | null
    | undefined
  >(undefined);
  const [finishing, setFinishing] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [userLoc, setUserLoc] = React.useState<RouteMapUserLocation | null>(null);

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
      // Punto azul del chofer (FASE A): best-effort, no bloquea la pantalla.
      void Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      })
        .then((pos) => {
          setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        })
        .catch(() => undefined);
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
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      >
        <ConnectionBanner
          isOnline={isOnline}
          isSyncing={isSyncing}
          pendingCount={pendingCount}
        />

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ gap: spacing.xs }}>
            <Text
              style={{ fontFamily: fonts.sansBold, fontSize: 22, color: colors.text }}
            >
              {routeInfo
                ? `RUTA ${String(routeInfo.routeNumber).padStart(3, "0")}`
                : "SIN RUTA"}
            </Text>
            <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.muted }}>
              {completed} de {routeInfo?.stops.length ?? 0} paradas entregadas
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setOnService((v) => !v)}
            style={{
              paddingHorizontal: spacing.md,
              height: 44,
              borderRadius: radius.md,
              backgroundColor: onService ? colors.success : colors.surface2,
              borderWidth: 1,
              borderColor: onService ? colors.success : colors.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontFamily: fonts.sansSemibold,
                fontSize: 13,
                color: onService ? colors.bg : colors.muted,
              }}
            >
              {onService ? "⚡ EN SERVICIO" : "Fuera de servicio"}
            </Text>
          </TouchableOpacity>
        </View>

        {lastError && (
          <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.warning }}>
            {lastError}
          </Text>
        )}

        {!routeInfo && (
          <View style={cardStyle}>
            <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.muted }}>
              Todavía no tenés una ruta descargada — pedila desde Más.
            </Text>
          </View>
        )}

        {routeInfo && routeInfo.stops.length > 0 && (
          <RouteMapView
            stops={routeInfo.stops
              .filter((s) => s.lat != null && s.lng != null)
              .map((s) => ({
                id: s.id,
                sequence: s.sequence,
                lat: s.lat!,
                lng: s.lng!,
                status: s.status,
              }))}
            userLocation={userLoc}
            height={360}
            onStopPress={(stopId) => router.push(`/parada/${stopId}`)}
          />
        )}

        {routeInfo &&
          routeInfo.stops.map((stop) => {
            const completedStop = stop.status === "COMPLETED" || stop.status === "FAILED";
            return (
              <View key={stop.id} style={cardStyle}>
                <TouchableOpacity
                  onPress={() => router.push(`/parada/${stop.id}`)}
                  style={{ flex: 1, gap: spacing.xs }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.sm,
                    }}
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

                {isInTransit && !completedStop && (
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
              <Text
                style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}
              >
                FINALIZAR RUTA
              </Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* FAB de 3 puntitos — acciones de escaneo (FASE A): la propia ruta
          ahora mismo; ruta de colega y colecta próximamente. */}
      <TouchableOpacity
        onPress={() => setSheetOpen(true)}
        activeOpacity={0.85}
        style={{
          position: "absolute",
          right: spacing.lg,
          bottom: spacing.lg,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: colors.text,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.25,
          shadowRadius: 6,
          elevation: 6,
        }}
        accessibilityLabel="Acciones de escaneo"
      >
        <Text
          style={{
            fontFamily: fonts.sansBold,
            fontSize: 24,
            lineHeight: 28,
            color: colors.bg,
          }}
        >
          ⋮
        </Text>
      </TouchableOpacity>

      <RouteActionsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onScanRoute={() => {
          setSheetOpen(false);
          router.push("/escanear-ruta");
        }}
      />
    </View>
  );
}

function RouteActionsSheet({
  open,
  onClose,
  onScanRoute,
}: {
  open: boolean;
  onClose: () => void;
  onScanRoute: () => void;
}) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }}
        onPress={onClose}
      >
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              padding: spacing.lg,
              gap: spacing.sm,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.sansSemibold,
                fontSize: 13,
                color: colors.muted,
                marginBottom: spacing.xs,
              }}
            >
              Escanear
            </Text>
            <SheetOption
              title="Escanear ruta"
              subtitle="Tu ruta asignada — abre la custodia"
              onPress={onScanRoute}
            />
            <SheetOption title="Escanear ruta de tu colega" subtitle="Próximamente" />
            <SheetOption title="Escanear ruta de colecta" subtitle="Próximamente" />
            <TouchableOpacity
              onPress={onClose}
              style={{
                marginTop: spacing.xs,
                height: touch.primaryButton,
                borderRadius: radius.md,
                backgroundColor: colors.surface2,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.sansSemibold,
                  fontSize: 17,
                  color: colors.text,
                }}
              >
                Cerrar
              </Text>
            </TouchableOpacity>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function SheetOption({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      style={{
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        backgroundColor: onPress ? colors.surface2 : "transparent",
        borderWidth: 1,
        borderColor: onPress ? colors.border : "transparent",
        opacity: onPress ? 1 : 0.55,
      }}
    >
      <Text style={{ fontFamily: fonts.sansSemibold, fontSize: 16, color: colors.text }}>
        {title}
      </Text>
      <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.muted }}>
        {subtitle}
      </Text>
    </TouchableOpacity>
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

function ConnectionBanner({
  isOnline,
  isSyncing,
  pendingCount,
}: {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
}) {
  if (isOnline && pendingCount === 0) return null;

  return (
    <View
      style={{
        backgroundColor: isOnline ? "rgba(245,158,11,0.13)" : "rgba(239,68,68,0.13)",
        borderWidth: 1,
        borderColor: isOnline ? "rgba(245,158,11,0.3)" : "rgba(239,68,68,0.3)",
        borderRadius: radius.md,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.sansMedium,
          fontSize: 13,
          color: isOnline ? colors.warning : colors.danger,
          flex: 1,
        }}
      >
        {!isOnline
          ? "Sin conexión — todo se guarda local"
          : isSyncing
            ? "Sincronizando…"
            : `${pendingCount} acción(es) pendientes de sincronizar`}
      </Text>
    </View>
  );
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
