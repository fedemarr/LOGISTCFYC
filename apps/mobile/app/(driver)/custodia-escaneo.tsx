import * as React from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { getDeviceId } from "../../src/lib/device";
import { mapBarcodeType } from "../../src/lib/barcode-format";
import {
  finishFullScan,
  getCustodyState,
  scanPackageForCustody,
  startCustody,
  type CustodyFinishResult,
} from "../../src/lib/custody";
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

type Mode = "container" | "packages";
type BannerState = { kind: "ok" | "duplicate" | "error"; text: string } | null;

function bannerColor(kind: "ok" | "duplicate" | "error"): string {
  if (kind === "ok") return colors.success;
  if (kind === "duplicate") return colors.warning;
  return colors.danger;
}

/**
 * Cámara de custodia (§9.3):
 * - modo `container`: escanea el QR del contenedor asignado y abre el acta
 *   (paso 1). Al resolver, vuelve a la pantalla de custodia.
 * - modo `packages`: escaneo individual de bultos ante una diferencia
 *   (paso 3), con chequeo cruzado reportado por el servidor. Un botón
 *   "Terminar" cierra el escaneo (paso 4).
 *
 * El modo se resuelve leyendo el estado de custodia al abrir: sin acta →
 * contenedor; acta DISCREPANCY → bultos.
 */
export default function CustodiaEscanearScreen() {
  const router = useRouter();
  const playFeedback = useScanFeedback();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = React.useState<Mode | null>(null);
  const [routeId, setRouteId] = React.useState<string | null>(null);
  const [paused, setPaused] = React.useState(false);
  const [banner, setBanner] = React.useState<BannerState>(null);
  const [scannedCount, setScannedCount] = React.useState(0);
  const [expectedCount, setExpectedCount] = React.useState(0);
  const [result, setResult] = React.useState<CustodyFinishResult | null>(null);
  const [finishing, setFinishing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const cooldownRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Freno sincrónico contra escaneos superpuestos (crash real reportado
  // por Fede escaneando bultos rápido y seguido): `paused` es estado de
  // React, se aplica recién en el próximo render — la cámara nativa
  // puede disparar `onBarcodeScanned` un par de veces más ANTES de que
  // React llegue a sacar el callback, así que varios escaneos entraban
  // en simultáneo (llamadas a red + audio + háptica pisándose entre
  // sí). Un ref se escribe al instante, sin esperar un render.
  const processingRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    void getCustodyState()
      .then((s) => {
        if (cancelled) return;
        if (s.custody && s.custody.status === "DISCREPANCY") {
          setMode("packages");
          setRouteId(s.route?.id ?? null);
          setScannedCount(s.scannedCount);
          setExpectedCount(s.custody.expectedCount);
        } else if (!s.custody) {
          setMode("container");
        } else {
          setMode("container");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError("No se pudo leer el estado de custodia");
      });
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

  async function handleContainerScan(rawCode: string) {
    try {
      await startCustody({ containerCode: rawCode });
      playFeedback("ok");
      router.back();
    } catch (err) {
      playFeedback("error");
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Contenedor no válido",
      });
      resumeAfterCooldown();
    }
  }

  async function handlePackageScan(rawCode: string, codeFormat: string) {
    if (!routeId) return;
    try {
      const deviceId = await getDeviceId();
      const outcome = await scanPackageForCustody({
        routeId,
        rawCode,
        codeFormat: mapBarcodeType(codeFormat),
        deviceId,
      });

      if (outcome.match === "wrong_route") {
        playFeedback("error");
        setBanner({
          kind: "error",
          text: `BULTO NO ENCONTRADO — pertenece a la RUTA ${String(
            outcome.otherRouteNumber ?? 0,
          ).padStart(3, "0")}`,
        });
      } else if (outcome.match === "extra") {
        playFeedback("error");
        setBanner({ kind: "error", text: "Bulto sobrante — no es de esta ruta" });
      } else if (outcome.duplicate) {
        playFeedback("duplicate");
        setBanner({
          kind: "duplicate",
          text: `Ya escaneado — #${outcome.package?.internalCode ?? ""}`,
        });
      } else {
        playFeedback("ok");
        setBanner({
          kind: "ok",
          text: `OK — #${outcome.package?.internalCode ?? ""}`,
        });
      }
      setScannedCount(outcome.scannedCount);
      setExpectedCount(outcome.expectedCount);
      resumeAfterCooldown();
    } catch (err) {
      playFeedback("error");
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Error al escanear",
      });
      resumeAfterCooldown();
    }
  }

  async function handleBarcode(rawCode: string, codeFormat: string) {
    if (processingRef.current || paused || !mode) return;
    processingRef.current = true;
    setPaused(true);
    try {
      if (mode === "container") await handleContainerScan(rawCode);
      else await handlePackageScan(rawCode, codeFormat);
    } finally {
      processingRef.current = false;
    }
  }

  async function handleFinish() {
    if (!routeId || finishing) return;
    setFinishing(true);
    setError(null);
    try {
      const r = await finishFullScan(routeId);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cerrar el escaneo");
      setFinishing(false);
    }
  }

  if (result) {
    return <FinishResultView result={result} onDone={() => router.back()} />;
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
          FYC necesita la cámara para escanear.
        </Text>
        <TouchableOpacity
          onPress={() => void requestPermission()}
          style={buttonPrimaryStyle}
        >
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}>
            Dar permiso
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (mode === null) {
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
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        flash="auto"
        barcodeScannerSettings={{ barcodeTypes: [...SCANNED_BARCODE_TYPES] }}
        onBarcodeScanned={paused ? undefined : (e) => void handleBarcode(e.data, e.type)}
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
              {mode === "container"
                ? "Escané el QR del contenedor asignado"
                : `Escaneá los bultos · ${scannedCount}/${expectedCount}`}
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

          {mode === "packages" && (
            <TouchableOpacity
              onPress={() => void handleFinish()}
              disabled={finishing}
              style={buttonSecondaryStyle}
            >
              {finishing ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Text
                  style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.text }}
                >
                  Terminar escaneo
                </Text>
              )}
            </TouchableOpacity>
          )}

          {error && (
            <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.danger }}>
              {error}
            </Text>
          )}
        </View>
      </CameraView>
    </View>
  );
}

function FinishResultView({
  result,
  onDone,
}: {
  result: CustodyFinishResult;
  onDone: () => void;
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      {result.status === "RESOLVED" ? (
        <>
          <Text
            style={{ fontFamily: fonts.sansBold, fontSize: 20, color: colors.success }}
          >
            Custodia confirmada
          </Text>
          <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.muted }}>
            La diferencia era un error de conteo. No quedaron faltantes ni sobrantes.
          </Text>
        </>
      ) : (
        <>
          <Text
            style={{ fontFamily: fonts.sansBold, fontSize: 20, color: colors.warning }}
          >
            Sigue la diferencia
          </Text>
          <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.muted }}>
            Avisale al depósito o pedí el override del dispatcher antes de iniciar la
            ruta.
          </Text>
          {result.missing.length > 0 && (
            <View style={cardStyle}>
              <Text
                style={{
                  fontFamily: fonts.sansSemibold,
                  fontSize: 14,
                  color: colors.danger,
                }}
              >
                Faltan ({result.missing.length})
              </Text>
              {result.missing.map((m) => (
                <Text
                  key={m.packageId}
                  style={{ fontFamily: fonts.mono, fontSize: 13, color: colors.text }}
                >
                  #{m.internalCode}
                </Text>
              ))}
            </View>
          )}
          {result.extra.length > 0 && (
            <View style={cardStyle}>
              <Text
                style={{
                  fontFamily: fonts.sansSemibold,
                  fontSize: 14,
                  color: colors.warning,
                }}
              >
                Sobran ({result.extra.length})
              </Text>
              {result.extra.map((e, i) => (
                <Text
                  key={i}
                  style={{ fontFamily: fonts.mono, fontSize: 13, color: colors.text }}
                >
                  {e.rawCode}
                  {e.otherRouteNumber
                    ? ` → RUTA ${String(e.otherRouteNumber).padStart(3, "0")}`
                    : ""}
                </Text>
              ))}
            </View>
          )}
        </>
      )}
      <TouchableOpacity onPress={onDone} style={buttonPrimaryStyle}>
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}>
          Volver
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const cardStyle = {
  backgroundColor: colors.surface2,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.border,
  padding: spacing.lg,
  gap: spacing.xs,
};

const buttonPrimaryStyle = {
  height: touch.primaryButton,
  borderRadius: radius.md,
  backgroundColor: colors.text,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};

const buttonSecondaryStyle = {
  height: touch.primaryButton,
  borderRadius: radius.md,
  backgroundColor: colors.surface2,
  borderWidth: 1,
  borderColor: colors.border,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};
