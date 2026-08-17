import * as React from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import * as Battery from "expo-battery";
import * as Location from "expo-location";
import { getCustodyState, startRoute } from "../../src/lib/custody";
import { getLocalRoute } from "../../src/lib/db/routes";
import {
  evaluateChecklist,
  type ChecklistEvaluation,
  type ChecklistItem,
} from "../../src/lib/route-checklist";
import { colors, fonts, radius, spacing, touch } from "../../src/theme/tokens";

type ChecklistPhase = "loading" | "ready";

/**
 * Checklist de inicio de ruta (§9.4). Mide en el device:
 * permiso de ubicación (incl. background), precisión GPS (< 50 m),
 * optimización de batería desactivada, ruta descargada en SQLite y
 * custodia confirmada (lo que devuelve el servidor vía `canStart`).
 * La batería <= 20 % es advertencia, NO bloquea.
 *
 * Solo se puede iniciar si todos los items bloqueantes están OK; el
 * botón envía el checklist completo al servidor (`POST /route/start`),
 * que revalida del lado suyo (FASE 8: nunca confiar solo en el device).
 */
export default function IniciarRutaScreen() {
  const router = useRouter();
  const db = useSQLiteContext();

  const [phase, setPhase] = React.useState<ChecklistPhase>("loading");
  const [evaluation, setEvaluation] = React.useState<ChecklistEvaluation | null>(null);
  const [routeId, setRouteId] = React.useState<string | null>(null);
  const [gps, setGps] = React.useState<{
    lat?: number;
    lng?: number;
    accuracyM: number | null;
  }>({ accuracyM: null });
  const [batteryLevel, setBatteryLevel] = React.useState<number | null>(null);
  const [attestation, setAttestation] = React.useState<{
    batteryOptimizationDisabled: boolean;
    locationPermissionGranted: boolean;
    routeDownloaded: boolean;
  } | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const measureChecklist = React.useCallback(
    async function measureChecklist(): Promise<{
      evaluation: ChecklistEvaluation | null;
      routeId: string | null;
      gps: { lat?: number; lng?: number; accuracyM: number | null };
      batteryLevel: number | null;
      attestation: {
        batteryOptimizationDisabled: boolean;
        locationPermissionGranted: boolean;
        routeDownloaded: boolean;
      } | null;
      error: string | null;
    }> {
      try {
        const [custodyState, foregroundPerm, backgroundPerm, localRoute] =
          await Promise.all([
            getCustodyState(),
            Location.getForegroundPermissionsAsync(),
            Location.getBackgroundPermissionsAsync(),
            getLocalRoute(db),
          ]);

        const locationPermissionGranted =
          foregroundPerm.granted && backgroundPerm.granted;

        let coords: { lat?: number; lng?: number; accuracy: number | null } = {
          lat: undefined,
          lng: undefined,
          accuracy: null,
        };
        if (locationPermissionGranted) {
          try {
            // `Accuracy.Highest` espera un fix GPS puro de precisión
            // máxima — adentro de un depósito (mala señal) esto podía
            // tardar muchísimo o no resolver nunca, dejando el checklist
            // trabado en "cargando" para siempre (queja real de Fede).
            // `High` combina GPS+red, responde mucho más rápido, y le
            // ponemos un timeout propio (expo-location no trae uno) para
            // que si ni así contesta, el checklist siga adelante en vez
            // de colgarse — el chofer ve "sin señal GPS" y puede
            // reintentar con "Verificar de nuevo" una vez que salga a un
            // lugar más despejado, en vez de mirar un spinner sin fin.
            const position = await Promise.race([
              Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), 8_000),
              ),
            ]);
            coords = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy ?? null,
            };
          } catch {
            coords = { lat: undefined, lng: undefined, accuracy: null };
          }
        }

        const batteryOptimizationDisabled =
          !(await Battery.isBatteryOptimizationEnabledAsync());
        const battery = await Battery.getBatteryLevelAsync();
        const routeDownloaded = localRoute != null && localRoute.stops.length > 0;

        const evaluation = evaluateChecklist({
          gpsAccuracyM: coords.accuracy,
          locationPermissionGranted,
          batteryOptimizationDisabled,
          routeDownloaded,
          batteryLevel: battery,
          canStart: custodyState.canStart,
        });

        return {
          evaluation,
          routeId: custodyState.route?.id ?? null,
          gps: { lat: coords.lat, lng: coords.lng, accuracyM: coords.accuracy },
          batteryLevel: battery,
          attestation: {
            batteryOptimizationDisabled,
            locationPermissionGranted,
            routeDownloaded,
          },
          error: null,
        };
      } catch (err) {
        return {
          evaluation: null,
          routeId: null,
          gps: { accuracyM: null },
          batteryLevel: null,
          attestation: null,
          error: err instanceof Error ? err.message : "No se pudo completar el checklist",
        };
      }
    },
    [db],
  );

  const applyResult = React.useCallback(function applyResult(
    result: Awaited<ReturnType<typeof measureChecklist>>,
  ) {
    if (result.error) {
      setError(result.error);
      setEvaluation(result.evaluation);
      setAttestation(result.attestation);
    } else {
      setError(null);
      setEvaluation(result.evaluation);
      setRouteId(result.routeId);
      setGps(result.gps);
      setBatteryLevel(result.batteryLevel);
      setAttestation(result.attestation);
    }
    setPhase("ready");
  }, []);

  React.useEffect(() => {
    void measureChecklist().then(applyResult);
  }, [measureChecklist, applyResult]);

  async function handleStart() {
    if (!routeId || !evaluation || !attestation) return;
    setSubmitting(true);
    setError(null);
    try {
      await startRoute({
        routeId,
        gpsAccuracyM: gps.accuracyM ?? 0,
        lat: gps.lat,
        lng: gps.lng,
        batteryLevel: batteryLevel ?? undefined,
        batteryOptimizationDisabled: attestation.batteryOptimizationDisabled,
        locationPermissionGranted: attestation.locationPermissionGranted,
        routeDownloaded: attestation.routeDownloaded,
      });
      router.replace("/ruta");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar la ruta");
      setSubmitting(false);
    }
  }

  if (phase === "loading") {
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

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
    >
      <View style={{ gap: spacing.xs }}>
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 22, color: colors.text }}>
          Iniciar ruta
        </Text>
        <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.muted }}>
          Checklist antes de salir (§9.4)
        </Text>
      </View>

      {error && (
        <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.danger }}>
          {error}
        </Text>
      )}

      {evaluation && (
        <View style={{ gap: spacing.sm }}>
          {evaluation.items.map((item) => (
            <ChecklistRow key={item.key} item={item} />
          ))}
          {evaluation.batteryLow && (
            <View style={[cardStyle, { borderColor: colors.warning, borderWidth: 1 }]}>
              <Text
                style={{
                  fontFamily: fonts.sansSemibold,
                  fontSize: 14,
                  color: colors.warning,
                }}
              >
                Batería baja ({Math.round((batteryLevel ?? 0) * 100)} %) — no bloquea,
                pero conectate un cargador si podés.
              </Text>
            </View>
          )}
        </View>
      )}

      <TouchableOpacity
        onPress={() => void measureChecklist().then(applyResult)}
        style={secondaryButtonStyle}
      >
        <Text
          style={{ fontFamily: fonts.sansSemibold, fontSize: 17, color: colors.text }}
        >
          Verificar de nuevo
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => void handleStart()}
        disabled={!evaluation?.canStart || submitting}
        style={[
          primaryButtonStyle,
          { opacity: evaluation?.canStart && !submitting ? 1 : 0.4 },
        ]}
      >
        {submitting ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}>
            Iniciar ruta
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  return (
    <View
      style={[cardStyle, { flexDirection: "row", alignItems: "center", gap: spacing.md }]}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: radius.sm,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: item.ok ? colors.success : colors.surface3,
        }}
      >
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 14, color: colors.bg }}>
          {item.ok ? "✓" : "!"}
        </Text>
      </View>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text
          style={{ fontFamily: fonts.sansSemibold, fontSize: 15, color: colors.text }}
        >
          {item.label}
        </Text>
        <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.muted }}>
          {item.detail}
        </Text>
      </View>
    </View>
  );
}

const cardStyle = {
  backgroundColor: colors.surface2,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.border,
  padding: spacing.lg,
  gap: spacing.md,
};

const primaryButtonStyle = {
  height: touch.primaryButton,
  borderRadius: radius.md,
  backgroundColor: colors.text,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};

const secondaryButtonStyle = {
  height: touch.primaryButton,
  borderRadius: radius.md,
  backgroundColor: colors.surface2,
  borderWidth: 1,
  borderColor: colors.border,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};
