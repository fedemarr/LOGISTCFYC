import * as React from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  getCustodyState,
  submitCustodyCount,
  type CustodyStateResult,
} from "../../src/lib/custody";
import { colors, fonts, radius, spacing, touch } from "../../src/theme/tokens";

/**
 * Custodia y carga (§9.3) — pantalla principal del flujo. Lee el estado
 * desde el servidor y muestra el paso en el que está el chofer:
 *
 *   1. Sin acta          → "Escanear contenedor" (abre la cámara)
 *   2. Acta sin conteo   → input de conteo rápido ("RUTA 002 — Esperados: N")
 *   3. DISCREPANCY       → "Escaneo individual" + diferencia a la vista
 *   4. Custodia OK       → "Iniciar ruta" (navega al checklist §9.4)
 *
 * Se re-lee con `useFocusEffect` para que al volver de cámara o del
 * checklist muestre siempre el estado fresco.
 */
export default function CustodiaScreen() {
  const router = useRouter();
  const [state, setState] = React.useState<CustodyStateResult | null | undefined>(
    undefined,
  );
  const [error, setError] = React.useState<string | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      void getCustodyState()
        .then((s) => {
          if (cancelled) return;
          setState(s);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setState(null);
          setError(err instanceof Error ? err.message : "No se pudo leer la custodia");
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  if (state === undefined) {
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

  if (state === null) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      >
        <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.danger }}>
          {error ?? "No se pudo leer el estado de custodia"}
        </Text>
        <TouchableOpacity
          onPress={() => router.push("/ruta")}
          style={secondaryButtonStyle}
        >
          <Text
            style={{ fontFamily: fonts.sansSemibold, fontSize: 17, color: colors.text }}
          >
            Volver a Ruta
          </Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  const route = state.route;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
    >
      <View style={{ gap: spacing.xs }}>
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 22, color: colors.text }}>
          Custodia y carga
        </Text>
        <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.muted }}>
          Conteo del contenedor antes de salir
        </Text>
      </View>

      {!route && (
        <View style={cardStyle}>
          <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.muted }}>
            No tenés una ruta activa para custodiar. Descargala desde Inicio y esperá a
            que te la aprueben.
          </Text>
        </View>
      )}

      {error && (
        <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.danger }}>
          {error}
        </Text>
      )}

      {route && <RouteCard state={state} />}

      {route && (
        <CustodyAction
          route={route}
          custody={state.custody}
          scannedCount={state.scannedCount}
          onChanged={setState}
          onError={setError}
        />
      )}

      {state.canStart && (
        <TouchableOpacity
          onPress={() => router.push("/iniciar-ruta")}
          style={primaryButtonStyle}
        >
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}>
            Iniciar ruta
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        onPress={() => router.push("/escanear")}
        style={secondaryButtonStyle}
      >
        <Text
          style={{ fontFamily: fonts.sansSemibold, fontSize: 17, color: colors.text }}
        >
          Escanear paquetes
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function RouteCard({ state }: { state: CustodyStateResult }) {
  const route = state.route;
  if (!route) return null;
  return (
    <View style={[cardStyle, { overflow: "hidden" }]}>
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          backgroundColor: route.colorHex ?? colors.muted,
        }}
      />
      <View style={{ gap: spacing.xs }}>
        <Text style={{ fontFamily: fonts.monoBold, fontSize: 15, color: colors.text }}>
          RUTA {String(route.routeNumber).padStart(3, "0")}
        </Text>
        <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.muted }}>
          {route.plannedStops ?? 0} paradas · estado {route.status}
        </Text>
        {state.container && (
          <Text style={{ fontFamily: fonts.mono, fontSize: 13, color: colors.muted2 }}>
            Contenedor {state.container.code}
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * Acción según el paso del flujo (§9.3):
 * - sin acta → botón que abre la cámara para escanear el contenedor
 * - acta sin conteo → form de conteo rápido (tipear cantidad)
 * - DISCREPANCY → aviso de diferencia + botón de escaneo individual
 */
function CustodyAction({
  route,
  custody,
  scannedCount,
  onChanged,
  onError,
}: {
  route: NonNullable<CustodyStateResult["route"]>;
  custody: CustodyStateResult["custody"];
  scannedCount: number;
  onChanged: (s: CustodyStateResult) => void;
  onError: (m: string | null) => void;
}) {
  const router = useRouter();
  const [count, setCount] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const counted = custody != null && custody.countedCount != null;

  if (!custody) {
    return (
      <TouchableOpacity
        onPress={() => router.push("/custodia-escaneo")}
        style={primaryButtonStyle}
      >
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}>
          Escanear contenedor
        </Text>
      </TouchableOpacity>
    );
  }

  if (custody.status === "DISCREPANCY") {
    return (
      <View style={[cardStyle, { borderColor: colors.warning, borderWidth: 1 }]}>
        <Text
          style={{ fontFamily: fonts.sansSemibold, fontSize: 16, color: colors.warning }}
        >
          Diferencia de conteo
        </Text>
        <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.muted }}>
          Contaste {custody.countedCount} y se esperaban {custody.expectedCount}. Escaneá
          los bultos uno por uno para identificar el faltante o sobrante.
        </Text>
        <TouchableOpacity
          onPress={() => router.push("/custodia-escaneo")}
          style={secondaryButtonStyle}
        >
          <Text
            style={{ fontFamily: fonts.sansSemibold, fontSize: 17, color: colors.text }}
          >
            Escanear bultos ({scannedCount} hechos)
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (counted) {
    return (
      <View style={cardStyle}>
        <Text
          style={{ fontFamily: fonts.sansSemibold, fontSize: 16, color: colors.success }}
        >
          Custodia confirmada
        </Text>
        <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.muted }}>
          {custody.expectedCount} bultos contados, sin diferencias. Ya podés iniciar la
          ruta.
        </Text>
      </View>
    );
  }

  async function handleSubmitCount() {
    const parsed = Number(count);
    if (!Number.isInteger(parsed) || parsed < 0) {
      onError("Ingresá un número entero válido");
      return;
    }
    setSubmitting(true);
    onError(null);
    try {
      const updated = await submitCustodyCount({
        routeId: route.id,
        countedCount: parsed,
      });
      onChanged(updated);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo guardar el conteo");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={cardStyle}>
      <Text style={{ fontFamily: fonts.monoBold, fontSize: 15, color: colors.text }}>
        RUTA {String(route.routeNumber).padStart(3, "0")}
      </Text>
      <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.muted }}>
        Esperados: {custody.expectedCount} bultos
      </Text>
      <TextInput
        value={count}
        onChangeText={setCount}
        keyboardType="number-pad"
        placeholder="Cantidad real"
        placeholderTextColor={colors.muted2}
        style={{
          fontFamily: fonts.monoBold,
          fontSize: 24,
          color: colors.text,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          height: touch.primaryButton,
          textAlign: "center",
        }}
      />
      <TouchableOpacity
        onPress={() => void handleSubmitCount()}
        disabled={submitting}
        style={[primaryButtonStyle, { opacity: submitting ? 0.6 : 1 }]}
      >
        {submitting ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}>
            Confirmar conteo
          </Text>
        )}
      </TouchableOpacity>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {[
          custody.expectedCount,
          custody.expectedCount - 1,
          custody.expectedCount + 1,
        ].map((n) =>
          n >= 0 ? (
            <TouchableOpacity
              key={n}
              onPress={() => setCount(String(n))}
              style={{
                flex: 1,
                height: touch.minTarget,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{ fontFamily: fonts.monoBold, fontSize: 16, color: colors.text }}
              >
                {n}
              </Text>
            </TouchableOpacity>
          ) : null,
        )}
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
