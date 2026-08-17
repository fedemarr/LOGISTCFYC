import * as React from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { parseRouteQrPayload } from "@fyc/shared";
import { startCustodyByRoute } from "../../src/lib/custody";
import { downloadCurrentRoute } from "../../src/lib/db/routes";
import { useScanFeedback } from "../../src/hooks/useScanFeedback";
import { colors, fonts, radius, spacing } from "../../src/theme/tokens";

const COOLDOWN_MS = 1200;
const BARCODE_TYPES = ["qr", "code128", "code39", "pdf417", "datamatrix"] as const;

/**
 * "Escanear ruta" (FASE A) — cámara que lee el QR de la tarjeta de la ruta
 * (`FYC-ROUTE-<routeId>`, generado en el panel de Ruteo). Al escanear:
 *
 *   1. `startCustodyByRoute(routeId)` — abre el acta de custodia de la ruta
 *      SIN escanear el contenedor físico (el QR codifica solo la ruta).
 *   2. `downloadCurrentRoute(db)` — baja la ruta + paradas a local, así la
 *      ruta aparece en la app (estado ASSIGNED → el tracking arranca y el
 *      chofer aparece en Seguimiento).
 *   3. Navega a `/custodia`, que sigue el flujo conocido: conteo → custodia
 *      → iniciar ruta.
 *
 * Si el QR no es de ruta, avisa y queda listo para volver a escanear.
 */
export default function EscanearRutaScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const playFeedback = useScanFeedback();
  const [permission, requestPermission] = useCameraPermissions();
  const [paused, setPaused] = React.useState(false);
  const [banner, setBanner] = React.useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const cooldownRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
    };
  }, []);

  function resumeAfterCooldown() {
    cooldownRef.current = setTimeout(() => {
      setPaused(false);
      setBanner(null);
    }, COOLDOWN_MS);
  }

  async function handleScan(rawCode: string) {
    const routeId = parseRouteQrPayload(rawCode);
    if (!routeId) {
      playFeedback("error");
      setBanner({
        kind: "error",
        text: "No es un QR de ruta — escaneá el QR de la tarjeta de la ruta en Ruteo",
      });
      resumeAfterCooldown();
      return;
    }

    setBanner({ kind: "ok", text: "Ruta reconocida, abriendo custodia…" });
    try {
      await startCustodyByRoute(routeId);
      await downloadCurrentRoute(db).catch(() => undefined);
      playFeedback("ok");
      router.replace("/custodia");
    } catch (err) {
      playFeedback("error");
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "No se pudo abrir la custodia",
      });
      resumeAfterCooldown();
    }
  }

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
          padding: spacing.xl,
          gap: spacing.lg,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.sans,
            fontSize: touchBaseFontSize,
            color: colors.text,
            textAlign: "center",
          }}
        >
          FYC necesita la cámara para escanear el QR de la ruta.
        </Text>
        <TouchableOpacity
          onPress={() => void requestPermission()}
          style={primaryButtonStyle}
        >
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}>
            Dar permiso
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        flash="auto"
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={paused ? undefined : (e) => void handleScan(e.data)}
      >
        <View style={{ flex: 1, justifyContent: "space-between", padding: spacing.lg }}>
          <View
            style={{
              backgroundColor: "rgba(15,17,21,0.75)",
              borderRadius: radius.md,
              padding: spacing.md,
              alignSelf: "flex-start",
            }}
          >
            <Text
              style={{ fontFamily: fonts.sansSemibold, fontSize: 13, color: colors.text }}
            >
              Escaneá el QR de la ruta (tarjeta en Ruteo)
            </Text>
          </View>

          <View style={{ alignItems: "center" }}>
            <View
              style={{
                width: 240,
                height: 140,
                borderRadius: radius.lg,
                borderWidth: 2,
                borderColor: banner
                  ? banner.kind === "ok"
                    ? colors.success
                    : colors.danger
                  : colors.text,
              }}
            />
          </View>

          {banner ? (
            <View
              style={{
                backgroundColor: banner.kind === "ok" ? colors.success : colors.danger,
                borderRadius: radius.md,
                padding: spacing.md,
                alignItems: "center",
              }}
            >
              <Text
                style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}
              >
                {banner.text}
              </Text>
            </View>
          ) : (
            <View style={{ height: 56 }}>
              {paused && <ActivityIndicator color={colors.text} />}
            </View>
          )}
        </View>
      </CameraView>
    </View>
  );
}

const touchBaseFontSize = 15;

const primaryButtonStyle = {
  height: 48,
  borderRadius: radius.md,
  backgroundColor: colors.text,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  alignSelf: "stretch" as const,
};
