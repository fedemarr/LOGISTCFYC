import * as React from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import { parseOcrAddressLines } from "@fyc/shared";
import { extractLabelText } from "../../../src/lib/ocr/extract";
import { assessOcrQuality } from "../../../src/lib/ocr/quality";
import { resolvePackageManually } from "../../../src/lib/scanning";
import { useScanFeedback } from "../../../src/hooks/useScanFeedback";
import { colors, fonts, radius, spacing, touch } from "../../../src/theme/tokens";

type Phase = "capture" | "processing" | "retake" | "confirm";

/**
 * Bandeja de resolución in-app (§9.1 pasos d/e, §14 FASE 8): foto de la
 * etiqueta → OCR on-device → campos editables → confirmar. El OCR corre
 * en el dispositivo (nunca se manda la foto al servidor para leerla) y
 * el parseo usa `parseOcrAddressLines` de `@fyc/shared` — la MISMA
 * función que el servidor tiene disponible para el escalón OCR de la
 * cascada (ver ADR de FASE 8: acá el resultado se manda ya CONFIRMADO
 * por un humano vía `/resolve`, no como sugerencia sin revisar).
 */
export default function EtiquetaScreen() {
  const { packageId, internalCode } = useLocalSearchParams<{
    packageId: string;
    internalCode?: string;
  }>();
  const router = useRouter();
  const playFeedback = useScanFeedback();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = React.useRef<CameraView>(null);

  const [phase, setPhase] = React.useState<Phase>("capture");
  const [photoUri, setPhotoUri] = React.useState<string | null>(null);
  const [capturing, setCapturing] = React.useState(false);

  const [street, setStreet] = React.useState("");
  const [number, setNumber] = React.useState("");
  const [floor, setFloor] = React.useState("");
  const [apartment, setApartment] = React.useState("");
  const [locality, setLocality] = React.useState("");
  const [recipientName, setRecipientName] = React.useState("");
  const [recipientPhone, setRecipientPhone] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function fillFromOcr(lines: string[]) {
    const parsed = parseOcrAddressLines(lines);
    setStreet(parsed?.street ?? "");
    setNumber(parsed?.number ?? "");
    setFloor(parsed?.floor ?? "");
    setApartment(parsed?.apartment ?? "");
    setLocality(parsed?.locality ?? "");
    setRecipientName(parsed?.recipientName ?? "");
    setRecipientPhone(parsed?.recipientPhone ?? "");
  }

  async function handleCapture() {
    if (capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.6 });
      if (!photo) return;
      setPhotoUri(photo.uri);
      setPhase("processing");

      const lines = await extractLabelText(photo.uri);
      const quality = assessOcrQuality(lines);
      if (!quality.ok) {
        setPhase("retake");
        return;
      }
      fillFromOcr(lines);
      setPhase("confirm");
    } finally {
      setCapturing(false);
    }
  }

  function handleManualEntry() {
    // "no bloquea el flujo" (§9.1) — si el OCR no sirve, el operador
    // completa a mano con la foto igual como referencia visual.
    setPhase("confirm");
  }

  async function handleConfirm() {
    if (!packageId) return;
    setError(null);

    const line1 = [street, number].filter(Boolean).join(" ");
    const line2 = [floor && `Piso ${floor}`, apartment && `Depto ${apartment}`]
      .filter(Boolean)
      .join(" ");
    const rawAddressText = [line1, line2, locality].filter(Boolean).join(", ");
    if (!rawAddressText.trim()) {
      setError("Completá al menos la calle y la altura.");
      return;
    }

    setSubmitting(true);
    try {
      await resolvePackageManually(packageId, {
        rawAddressText,
        recipientName: recipientName || undefined,
        recipientPhone: recipientPhone || undefined,
      });
      playFeedback("ok");
      router.replace("/escanear");
    } catch (err) {
      playFeedback("error");
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSubmitting(false);
    }
  }

  if (!permission) return null;

  if (!permission.granted && phase === "capture") {
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
          FYC necesita la cámara para fotografiar la etiqueta.
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

  if (phase === "capture") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" flash="auto">
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
                style={{
                  fontFamily: fonts.sansSemibold,
                  fontSize: 13,
                  color: colors.text,
                }}
              >
                #{internalCode ?? packageId} · Fotografiá la etiqueta
              </Text>
            </View>

            {/* Guía de encuadre (§14: "guía de encuadre") */}
            <View
              style={{
                alignSelf: "center",
                width: "82%",
                aspectRatio: 3 / 4,
                borderRadius: radius.lg,
                borderWidth: 2,
                borderColor: colors.text,
                borderStyle: "dashed",
              }}
            />

            <TouchableOpacity
              onPress={() => void handleCapture()}
              disabled={capturing}
              style={{
                alignSelf: "center",
                width: 76,
                height: 76,
                borderRadius: 38,
                backgroundColor: colors.text,
                borderWidth: 4,
                borderColor: colors.surface2,
                opacity: capturing ? 0.6 : 1,
              }}
            />
          </View>
        </CameraView>
      </View>
    );
  }

  if (phase === "processing") {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.md,
        }}
      >
        <ActivityIndicator color={colors.text} />
        <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.muted }}>
          Leyendo etiqueta…
        </Text>
      </View>
    );
  }

  if (phase === "retake") {
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
        {photoUri && (
          <Image
            source={{ uri: photoUri }}
            style={{ width: 180, height: 240, borderRadius: radius.md }}
          />
        )}
        <Text
          style={{
            fontFamily: fonts.sansSemibold,
            fontSize: 17,
            color: colors.text,
            textAlign: "center",
          }}
        >
          No se pudo leer la etiqueta
        </Text>
        <Text
          style={{
            fontFamily: fonts.sans,
            fontSize: 15,
            color: colors.muted,
            textAlign: "center",
          }}
        >
          La foto puede estar borrosa, oscura o mal encuadrada.
        </Text>
        <TouchableOpacity
          onPress={() => setPhase("capture")}
          style={{
            height: touch.primaryButton,
            width: "100%",
            borderRadius: radius.md,
            backgroundColor: colors.text,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}>
            Reintentar foto
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleManualEntry}
          style={{ minHeight: touch.minTarget, justifyContent: "center" }}
        >
          <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.muted }}>
            Cargar la dirección a mano
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // phase === "confirm"
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <Text style={{ fontFamily: fonts.sansBold, fontSize: 20, color: colors.text }}>
        Confirmá la dirección
      </Text>
      <Text style={{ fontFamily: fonts.mono, fontSize: 13, color: colors.muted }}>
        #{internalCode ?? packageId}
      </Text>

      {photoUri && (
        <Image
          source={{ uri: photoUri }}
          style={{ width: "100%", height: 200, borderRadius: radius.md }}
          resizeMode="cover"
        />
      )}

      <Field label="Calle" value={street} onChangeText={setStreet} />
      <Field
        label="Altura"
        value={number}
        onChangeText={setNumber}
        keyboardType="number-pad"
      />
      <Field label="Piso" value={floor} onChangeText={setFloor} />
      <Field label="Depto" value={apartment} onChangeText={setApartment} />
      <Field label="Localidad" value={locality} onChangeText={setLocality} />
      <Field label="Destinatario" value={recipientName} onChangeText={setRecipientName} />
      <Field
        label="Teléfono"
        value={recipientPhone}
        onChangeText={setRecipientPhone}
        keyboardType="phone-pad"
      />

      {error && (
        <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.danger }}>
          {error}
        </Text>
      )}

      <TouchableOpacity
        onPress={() => void handleConfirm()}
        disabled={submitting}
        style={{
          height: touch.primaryButton,
          borderRadius: radius.md,
          backgroundColor: colors.text,
          alignItems: "center",
          justifyContent: "center",
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}>
            Confirmar
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: "default" | "number-pad" | "phone-pad";
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text
        style={{
          fontFamily: fonts.sansMedium,
          fontSize: 12,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: colors.muted,
        }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholderTextColor={colors.muted2}
        style={{
          fontFamily: fonts.sans,
          fontSize: touch.baseFontSize,
          color: colors.text,
          backgroundColor: colors.surface2,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          height: touch.minTarget,
        }}
      />
    </View>
  );
}
