import * as React from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { getDeviceId } from "../../src/lib/device";
import { mapBarcodeType } from "../../src/lib/barcode-format";
import { getOpenOperation, scanCode } from "../../src/lib/scanning";
import { useScanFeedback } from "../../src/hooks/useScanFeedback";
import { colors, fonts, radius, spacing, touch } from "../../src/theme/tokens";

const COOLDOWN_MS = 1200;
const SCANNED_BARCODE_TYPES = [
  "qr",
  "code128",
  "code39",
  "pdf417",
  "datamatrix",
  "ean13",
] as const;

type BannerState = { kind: "ok" | "duplicate" | "error"; text: string } | null;

function bannerColor(kind: "ok" | "duplicate" | "error"): string {
  if (kind === "ok") return colors.success;
  if (kind === "duplicate") return colors.warning;
  return colors.danger;
}

/**
 * Escaneo en loop de alta velocidad (§14 FASE 8, "modo depósito"): la
 * cámara nunca se detiene salvo el cooldown corto después de cada
 * lectura, para no leer el mismo código dos veces por descuido. Feedback
 * sonoro/háptico por resultado — el operador no necesita mirar la
 * pantalla para saber si siga.
 */
export default function EscanearScreen() {
  const router = useRouter();
  const playFeedback = useScanFeedback();
  const [permission, requestPermission] = useCameraPermissions();
  const [operationId, setOperationId] = React.useState<string | null | undefined>(
    undefined,
  );
  const [paused, setPaused] = React.useState(false);
  const [banner, setBanner] = React.useState<BannerState>(null);
  const cooldownRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const op = await getOpenOperation().catch(() => null);
      if (cancelled) return;
      setOperationId(op?.id ?? null);
    })();
    return () => {
      cancelled = true;
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
    };
  }, []);

  function resumeAfterCooldown() {
    cooldownRef.current = setTimeout(() => {
      setPaused(false);
      setBanner(null);
    }, COOLDOWN_MS);
  }

  async function handleBarcodeScanned(rawCode: string, format: string) {
    if (paused || !operationId) return;
    setPaused(true);

    try {
      const deviceId = await getDeviceId();
      const outcome = await scanCode(operationId, {
        rawCode,
        codeFormat: mapBarcodeType(format),
        deviceId,
      });

      if (outcome.duplicate) {
        playFeedback("duplicate");
        setBanner({ kind: "duplicate", text: `Ya escaneado — #${outcome.internalCode}` });
        resumeAfterCooldown();
        return;
      }

      if (outcome.resolution.resolved) {
        playFeedback("ok");
        setBanner({ kind: "ok", text: `OK — #${outcome.internalCode}` });
        resumeAfterCooldown();
        return;
      }

      // No resolvió por código — hace falta la foto de la etiqueta (§9.1 pasos d/e).
      playFeedback("error");
      router.push({
        pathname: "/etiqueta/[packageId]",
        params: { packageId: outcome.packageId, internalCode: outcome.internalCode },
      });
    } catch (err) {
      playFeedback("error");
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Error al escanear",
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
            fontSize: touch.baseFontSize,
            color: colors.text,
            textAlign: "center",
          }}
        >
          FYC necesita la cámara para escanear los paquetes.
        </Text>
        <TouchableOpacity
          onPress={() => void requestPermission()}
          style={{
            height: touch.primaryButton,
            paddingHorizontal: spacing.xl,
            borderRadius: radius.md,
            backgroundColor: colors.text,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}>
            Dar permiso
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (operationId === undefined) {
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

  if (operationId === null) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
          padding: spacing.xl,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.sans,
            fontSize: touch.baseFontSize,
            color: colors.muted,
            textAlign: "center",
          }}
        >
          No hay una operación abierta hoy. Creála desde el panel web (Depósito) antes de
          escanear.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        flash="auto"
        barcodeScannerSettings={{ barcodeTypes: [...SCANNED_BARCODE_TYPES] }}
        onBarcodeScanned={
          paused ? undefined : (e) => void handleBarcodeScanned(e.data, e.type)
        }
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
              Modo depósito — escaneo en loop
            </Text>
          </View>

          <View style={{ alignItems: "center" }}>
            <View
              style={{
                width: 240,
                height: 140,
                borderRadius: radius.lg,
                borderWidth: 2,
                borderColor: banner ? bannerColor(banner.kind) : colors.text,
              }}
            />
          </View>

          {banner ? (
            <View
              style={{
                backgroundColor: bannerColor(banner.kind),
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
            <View style={{ height: 56 }} />
          )}
        </View>
      </CameraView>
    </View>
  );
}
