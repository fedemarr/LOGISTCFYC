import * as React from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useSession } from "../../src/context/session";
import { useSyncStore } from "../../src/lib/sync/store";
import { downloadCurrentRoute, getLocalRoute } from "../../src/lib/db/routes";
import { colors, fonts, radius, spacing, touch } from "../../src/theme/tokens";

interface LocalRouteSummary {
  routeNumber: number;
  status: string;
  stopCount: number;
  colorHex: string | null;
}

/**
 * Inicio (§13, mockup del chofer): estado de sync/conexión siempre
 * visible, y la ruta descargada localmente. El toggle "EN SERVICIO" y el
 * inicio real de ruta (validaciones de §9.4: custodia, GPS, batería) son
 * FASE 9/10 — acá es un estado de UI simple para no dejar el botón
 * muerto, sin las validaciones bloqueantes todavía.
 */
export default function InicioScreen() {
  const db = useSQLiteContext();
  const { signOut } = useSession();
  const { isOnline, isSyncing, pendingCount, lastError } = useSyncStore();
  const [localRoute, setLocalRoute] = React.useState<
    LocalRouteSummary | null | undefined
  >(undefined);
  const [downloading, setDownloading] = React.useState(false);
  const [onService, setOnService] = React.useState(false);

  const loadLocalRoute = React.useCallback(async () => {
    const result = await getLocalRoute(db);
    setLocalRoute(
      result
        ? {
            routeNumber: result.route.route_number,
            status: result.route.status,
            stopCount: result.stops.length,
            colorHex: result.route.color_hex,
          }
        : null,
    );
  }, [db]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadLocalRoute();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadLocalRoute]);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadCurrentRoute(db);
      await loadLocalRoute();
    } finally {
      setDownloading(false);
    }
  }

  return (
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
        <View>
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 22, color: colors.text }}>
            FYC
          </Text>
          <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.muted }}>
            App del chofer
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

      <View
        style={{
          backgroundColor: colors.surface2,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: spacing.lg,
          overflow: "hidden",
        }}
      >
        {localRoute && (
          <View
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              backgroundColor: localRoute.colorHex ?? colors.muted,
            }}
          />
        )}
        {localRoute === undefined ? (
          <ActivityIndicator color={colors.muted} />
        ) : localRoute ? (
          <View style={{ gap: spacing.xs }}>
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 14,
                fontWeight: "700",
                color: colors.text,
              }}
            >
              RUTA {String(localRoute.routeNumber).padStart(3, "0")}
            </Text>
            <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.muted }}>
              {localRoute.stopCount} paradas · descargada a este dispositivo
            </Text>
          </View>
        ) : (
          <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.muted }}>
            Todavía no tenés una ruta descargada.
          </Text>
        )}
      </View>

      <TouchableOpacity
        onPress={() => void handleDownload()}
        disabled={downloading}
        style={{
          height: touch.primaryButton,
          borderRadius: radius.md,
          backgroundColor: colors.surface2,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: "center",
          justifyContent: "center",
          opacity: downloading ? 0.6 : 1,
        }}
      >
        {downloading ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text
            style={{ fontFamily: fonts.sansSemibold, fontSize: 17, color: colors.text }}
          >
            Descargar mi ruta
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => void signOut()}
        style={{
          minHeight: touch.minTarget,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.muted }}>
          Cerrar sesión
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
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
