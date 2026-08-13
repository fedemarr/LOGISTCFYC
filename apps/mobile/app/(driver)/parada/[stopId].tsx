import * as React from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { randomUUID } from "expo-crypto";
import { getPendingCount } from "../../../src/lib/sync/outbox";
import { useSyncStore } from "../../../src/lib/sync/store";
import {
  getLocalRoute,
  getLocalStop,
  markStopArrivedSent,
  setLocalStopStatus,
} from "../../../src/lib/db/routes";
import {
  enqueueDeliveryDelivered,
  enqueueDeliveryFailed,
  enqueueStopArrived,
} from "../../../src/lib/delivery";
import { enqueueLocalPhoto } from "../../../src/lib/media";
import { getDeviceId } from "../../../src/lib/device";
import { haversineDistanceMeters } from "../../../src/lib/geo";
import { colors, fonts, radius, spacing, touch } from "../../../src/theme/tokens";

const RELATIONSHIPS = ["FAMILIAR", "VECINO", "PORTERO", "OTRO"] as const;

const FAIL_REASONS: { key: string; label: string }[] = [
  { key: "NO_ONE_HOME", label: "No hay nadie" },
  { key: "NO_ANSWER", label: "No atiende" },
  { key: "WRONG_ADDRESS", label: "Dirección errónea" },
  { key: "REFUSED", label: "Rechaza el paquete" },
  { key: "NO_ACCESS", label: "Sin acceso" },
  { key: "DAMAGED", label: "Bulto dañado" },
  { key: "OTHER", label: "Otro" },
];

/**
 * Parada individual (§9.5-§9.7) — el corazón del flujo de la calle:
 *
 *   - Al abrir la pantalla se encola STOP_ARRIVED (una sola vez, guardado
 *     por `arrived_sent`).
 *   - Navegación con deep links: Google Maps / Waze.
 *   - ENTREGA en 3 toques (§9.6): formulario (receptor obligatorio +
 *     relación + foto) → confirmación → registro. La foto va primero a
 *     `local_media` (offline-first); si hay red en ese momento se sube ya
 *     y el path viaja con la entrega, si no la sube `flushMedia` y la
 *     adjunta con DELIVERY_PHOTO_ATTACH.
 *   - INCIDENCIA (§9.7): motivo obligatorio + foto obligatoria + comentario.
 *
 * Toda operación encola al outbox local y actualiza SQLite optimista.
 */
export default function ParadaScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { setPendingCount } = useSyncStore();

  const [loading, setLoading] = React.useState(true);
  const [stop, setStop] = React.useState<Awaited<ReturnType<typeof getLocalStop>>>(null);
  const [route, setRoute] = React.useState<Awaited<
    ReturnType<typeof getLocalRoute>
  > | null>(null);
  const [distanceM, setDistanceM] = React.useState<number | null>(null);

  // Modales: "entregar" y "incidencia" — cada uno con sub-pasos.
  const [deliverOpen, setDeliverOpen] = React.useState(false);
  const [deliverStep, setDeliverStep] = React.useState<"form" | "confirm">("form");
  const [receiverName, setReceiverName] = React.useState("");
  const [relationship, setRelationship] = React.useState<string | null>(null);
  const [photoUri, setPhotoUri] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const [failOpen, setFailOpen] = React.useState(false);
  const [failReason, setFailReason] = React.useState<string | null>(null);
  const [failPhotoUri, setFailPhotoUri] = React.useState<string | null>(null);
  const [failComment, setFailComment] = React.useState("");
  const [failing, setFailing] = React.useState(false);

  const routeId = route?.route.id ?? null;
  const inTransit = route?.route.status === "IN_TRANSIT";
  const done = stop?.status === "COMPLETED" || stop?.status === "FAILED";

  const refreshDistance = React.useCallback(async (): Promise<{
    lat: number;
    lng: number;
    accuracyM?: number;
  } | null> => {
    if (!stop?.lat || !stop.lng) return null;
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const coord = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setDistanceM(
        Math.round(haversineDistanceMeters(coord, { lat: stop.lat, lng: stop.lng })),
      );
      return { ...coord, accuracyM: pos.coords.accuracy ?? undefined };
    } catch {
      return null;
    }
  }, [stop]);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const stopRow = await getLocalStop(db, stopId);
          const routeRow = await getLocalRoute(db);
          if (cancelled) return;
          setStop(stopRow);
          setRoute(routeRow);
          setReceiverName(stopRow?.recipient_name ?? "");
          if (
            routeRow?.route.status === "IN_TRANSIT" &&
            stopRow &&
            stopRow.arrived_sent === 0
          ) {
            await enqueueStopArrived(db, routeRow.route.id, stopRow.id);
            await markStopArrivedSent(db, stopRow.id);
          }
        } catch {
          // Sin fila — se muestra el estado vacío.
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      void refreshDistance();
      return () => {
        cancelled = true;
      };
    }, [db, refreshDistance, stopId]),
  );

  async function takePhoto(): Promise<string | null> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permiso de cámara", "La evidencia requiere foto (§9.6).");
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsEditing: false,
    });
    if (result.canceled || result.assets.length === 0) return null;
    return result.assets[0]!.uri;
  }

  function openNavigation(app: "maps" | "waze"): void {
    if (!stop?.lat || !stop.lng) return;
    const url =
      app === "maps"
        ? `google.navigation:q=${stop.lat},${stop.lng}&mode=d`
        : `waze://?ll=${stop.lat},${stop.lng}&navigate=yes`;
    void Linking.canOpenURL(url).then((ok) => {
      if (ok) void Linking.openURL(url);
      else Alert.alert("App no instalada", "No se encontró la app de navegación.");
    });
  }

  function openDeliver(): void {
    setDeliverOpen(true);
    setDeliverStep("form");
    setRelationship(null);
    setPhotoUri(null);
    setSubmitting(false);
    void refreshDistance();
  }

  function openFail(): void {
    setFailOpen(true);
    setFailReason(null);
    setFailPhotoUri(null);
    setFailComment("");
    setFailing(false);
    void refreshDistance();
  }

  async function submitDelivery(): Promise<void> {
    if (!stop || !routeId) return;
    const name = receiverName.trim();
    if (!name) {
      Alert.alert(
        "Falta el receptor",
        "El nombre de quien recibe es obligatorio (§9.6).",
      );
      return;
    }
    if (deliverStep === "form") {
      setDeliverStep("confirm");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const pos = await refreshDistance();
      const deviceId = await getDeviceId();
      const deliveryKey = randomUUID();

      // Foto → local_media SIEMPRE (offline-first). El path se adjunta
      // después: con la entrega si sube ya, o vía DELIVERY_PHOTO_ATTACH.
      if (photoUri) {
        await enqueueLocalPhoto(db, {
          localUri: photoUri,
          mimeType: "image/jpeg",
          routeId,
          stopId: stop.id,
          deliveryKey,
        });
      }

      await enqueueDeliveryDelivered(db, {
        routeId,
        stopId: stop.id,
        receiverName: name,
        receiverRelationship: relationship ?? undefined,
        distanceFromTargetM: distanceM ?? 0,
        lat: pos?.lat ?? 0,
        lng: pos?.lng ?? 0,
        gpsAccuracyM: pos?.accuracyM,
        photoUrls: [], // las fotos se adjuntan vía DELIVERY_PHOTO_ATTACH
        deviceId,
      });
      await setLocalStopStatus(db, stop.id, "COMPLETED");
      setDeliverOpen(false);
      setStop({ ...stop, status: "COMPLETED" });
      setPendingCount(await getPendingCount(db));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Entrega registrada", "Se guardó y sincroniza sola. ", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "No se pudo registrar la entrega.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitFail(): Promise<void> {
    if (!stop || !routeId) return;
    if (!failReason) {
      Alert.alert("Falta el motivo", "Elegí el motivo de la incidencia (§9.7).");
      return;
    }
    if (!failPhotoUri) {
      Alert.alert("Falta la foto", "La foto de la incidencia es obligatoria (§9.7).");
      return;
    }
    if (failing) return;
    setFailing(true);
    try {
      const pos = await refreshDistance();
      const deviceId = await getDeviceId();
      await enqueueLocalPhoto(db, {
        localUri: failPhotoUri,
        mimeType: "image/jpeg",
        routeId,
        stopId: stop.id,
      });
      await enqueueDeliveryFailed(db, {
        routeId,
        stopId: stop.id,
        reason: failReason,
        comment: failComment.trim() || undefined,
        lat: pos?.lat,
        lng: pos?.lng,
        deviceId,
      });
      await setLocalStopStatus(db, stop.id, "FAILED");
      setFailOpen(false);
      setStop({ ...stop, status: "FAILED" });
      setPendingCount(await getPendingCount(db));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Incidencia reportada", "Operaciones la va a revisar.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "No se pudo reportar la incidencia.",
      );
    } finally {
      setFailing(false);
    }
  }

  if (loading) {
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

  if (!stop) {
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
            fontSize: 15,
            color: colors.muted,
            marginBottom: spacing.lg,
          }}
        >
          Parada no encontrada. Descargá la ruta desde Inicio.
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={secondaryButtonStyle}>
          <Text
            style={{ fontFamily: fonts.sansSemibold, fontSize: 15, color: colors.text }}
          >
            VOLVER
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const arrivedLabel =
    stop.status === "COMPLETED"
      ? "ENTREGADO"
      : stop.status === "FAILED"
        ? "INCIDENCIA"
        : "EN CURSO";
  const arrivedColor =
    stop.status === "COMPLETED"
      ? colors.success
      : stop.status === "FAILED"
        ? colors.danger
        : colors.active;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: spacing.xxxl,
        gap: spacing.md,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text style={{ fontFamily: fonts.monoBold, fontSize: 15, color: colors.muted }}>
          PARADA {String(stop.sequence).padStart(2, "0")}
        </Text>
        <View
          style={{
            backgroundColor: arrivedColor,
            borderRadius: radius.sm,
            paddingHorizontal: spacing.sm,
            paddingVertical: 3,
          }}
        >
          <Text
            style={{ fontFamily: fonts.sansSemibold, fontSize: 11, color: colors.bg }}
          >
            {arrivedLabel}
          </Text>
        </View>
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 22, color: colors.text }}>
          {stop.recipient_name ?? "Sin nombre de destinatario"}
        </Text>
        <Text style={{ fontFamily: fonts.mono, fontSize: 15, color: colors.text }}>
          BULTO {stop.bulk_number ?? "-"} · {stop.internal_code}
        </Text>
        {stop.tracking_code && (
          <Text style={{ fontFamily: fonts.mono, fontSize: 13, color: colors.muted }}>
            Tracking {stop.tracking_code}
          </Text>
        )}
      </View>

      {stop.raw_address_text && (
        <Text
          style={{
            fontFamily: fonts.sans,
            fontSize: 15,
            color: colors.text,
            lineHeight: 22,
          }}
        >
          {stop.raw_address_text}
        </Text>
      )}
      {stop.recipient_phone && (
        <TouchableOpacity
          onPress={() => void Linking.openURL(`tel:${stop.recipient_phone}`)}
        >
          <Text
            style={{ fontFamily: fonts.sansSemibold, fontSize: 15, color: colors.active }}
          >
            📞 {stop.recipient_phone}
          </Text>
        </TouchableOpacity>
      )}
      {stop.operational_notes && (
        <View
          style={{
            backgroundColor: colors.surface2,
            borderRadius: radius.md,
            padding: spacing.md,
            borderLeftWidth: 3,
            borderLeftColor: colors.warning,
          }}
        >
          <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.warning }}>
            {stop.operational_notes}
          </Text>
        </View>
      )}

      {distanceM != null && (
        <Text style={{ fontFamily: fonts.mono, fontSize: 13, color: colors.muted }}>
          📍 A {distanceM} m del domicilio
        </Text>
      )}

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <TouchableOpacity onPress={() => openNavigation("maps")} style={navButtonStyle}>
          <Text
            style={{ fontFamily: fonts.sansSemibold, fontSize: 14, color: colors.text }}
          >
            🗺 Maps
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => openNavigation("waze")} style={navButtonStyle}>
          <Text
            style={{ fontFamily: fonts.sansSemibold, fontSize: 14, color: colors.text }}
          >
            🧭 Waze
          </Text>
        </TouchableOpacity>
      </View>

      {done ? (
        <View
          style={{
            backgroundColor: colors.surface2,
            borderRadius: radius.md,
            padding: spacing.lg,
            alignItems: "center",
          }}
        >
          <Text
            style={{ fontFamily: fonts.sansSemibold, fontSize: 15, color: colors.muted }}
          >
            Parada{" "}
            {stop.status === "COMPLETED" ? "entregada" : "con incidencia reportada"}. Se
            cerró y no se modifica.
          </Text>
        </View>
      ) : inTransit ? (
        <>
          <TouchableOpacity onPress={openDeliver} style={primaryButtonStyle}>
            <Text style={primaryButtonTextStyle}>ENTREGAR</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={openFail} style={secondaryButtonStyle}>
            <Text
              style={{
                fontFamily: fonts.sansSemibold,
                fontSize: 17,
                color: colors.danger,
              }}
            >
              REPORTAR PROBLEMA
            </Text>
          </TouchableOpacity>
        </>
      ) : (
        <View
          style={{
            backgroundColor: colors.surface2,
            borderRadius: radius.md,
            padding: spacing.lg,
            alignItems: "center",
          }}
        >
          <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.muted }}>
            La ruta no está en tránsito — no se pueden registrar acciones.
          </Text>
        </View>
      )}

      {/* ── Modal ENTREGA ── */}
      <Modal
        visible={deliverOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setDeliverOpen(false)}
      >
        <View style={sheetOverlayStyle}>
          <View style={sheetCardStyle}>
            <Text
              style={{
                fontFamily: fonts.sansBold,
                fontSize: 20,
                color: colors.text,
                marginBottom: spacing.sm,
              }}
            >
              {deliverStep === "form" ? "¿Quién recibe?" : "Confirmar entrega"}
            </Text>
            {deliverStep === "form" ? (
              <>
                <TextInput
                  style={inputStyle}
                  value={receiverName}
                  onChangeText={setReceiverName}
                  placeholder="Nombre de quien recibe *"
                  placeholderTextColor={colors.muted2}
                  autoCapitalize="words"
                />
                <Text
                  style={{
                    fontFamily: fonts.sans,
                    fontSize: 13,
                    color: colors.muted,
                    marginTop: spacing.md,
                  }}
                >
                  Relación (opcional)
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: spacing.sm,
                    marginTop: spacing.sm,
                  }}
                >
                  {RELATIONSHIPS.map((rel) => (
                    <TouchableOpacity
                      key={rel}
                      onPress={() => setRelationship(rel === relationship ? null : rel)}
                      style={{
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor:
                          relationship === rel ? colors.active : colors.border2,
                        backgroundColor:
                          relationship === rel ? colors.active : colors.surface2,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.sm,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: fonts.sansSemibold,
                          fontSize: 13,
                          color: relationship === rel ? colors.bg : colors.text,
                        }}
                      >
                        {rel}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  onPress={() => void takePhoto().then((uri) => uri && setPhotoUri(uri))}
                  style={photoButtonStyle}
                >
                  <Text
                    style={{
                      fontFamily: fonts.sansSemibold,
                      fontSize: 14,
                      color: photoUri ? colors.success : colors.active,
                    }}
                  >
                    {photoUri
                      ? "✓ Foto tomada"
                      : stop.requires_photo
                        ? "📷 SACAR FOTO (obligatoria)"
                        : "📷 Foto (opcional)"}
                  </Text>
                </TouchableOpacity>

                <Text
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 12,
                    color: colors.muted,
                    marginTop: spacing.sm,
                  }}
                >
                  {distanceM != null ? `📍 a ${distanceM} m` : "calculando distancia…"}
                </Text>
              </>
            ) : (
              <>
                <View style={{ gap: spacing.sm, marginVertical: spacing.md }}>
                  <Text
                    style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.text }}
                  >
                    Receptor:{" "}
                    <Text style={{ fontFamily: fonts.sansSemibold }}>
                      {receiverName.trim()}
                    </Text>
                  </Text>
                  {relationship && (
                    <Text
                      style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.text }}
                    >
                      Relación:{" "}
                      <Text style={{ fontFamily: fonts.sansSemibold }}>
                        {relationship}
                      </Text>
                    </Text>
                  )}
                  <Text
                    style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.text }}
                  >
                    Foto:{" "}
                    <Text
                      style={{
                        fontFamily: fonts.sansSemibold,
                        color: photoUri ? colors.success : colors.warning,
                      }}
                    >
                      {photoUri
                        ? "incluida"
                        : stop.requires_photo
                          ? "FALTA (obligatoria)"
                          : "sin foto"}
                    </Text>
                  </Text>
                  <Text
                    style={{ fontFamily: fonts.mono, fontSize: 13, color: colors.muted }}
                  >
                    📍 {distanceM != null ? `${distanceM} m` : "sin GPS"}
                  </Text>
                </View>
              </>
            )}

            <TouchableOpacity
              onPress={() => void submitDelivery()}
              disabled={submitting}
              style={[primaryButtonStyle, { opacity: submitting ? 0.6 : 1 }]}
            >
              <Text style={primaryButtonTextStyle}>
                {submitting
                  ? "GUARDANDO…"
                  : deliverStep === "form"
                    ? "CONTINUAR"
                    : "ENTREGAR DEFINITIVO"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                deliverStep === "confirm" ? setDeliverStep("form") : setDeliverOpen(false)
              }
              style={{ alignSelf: "center", padding: spacing.md }}
            >
              <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.muted }}>
                {deliverStep === "confirm" ? "Volver" : "Cancelar"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Modal INCIDENCIA ── */}
      <Modal
        visible={failOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setFailOpen(false)}
      >
        <View style={sheetOverlayStyle}>
          <View style={sheetCardStyle}>
            <Text
              style={{
                fontFamily: fonts.sansBold,
                fontSize: 20,
                color: colors.text,
                marginBottom: spacing.sm,
              }}
            >
              Reportar incidencia
            </Text>
            <Text
              style={{
                fontFamily: fonts.sans,
                fontSize: 13,
                color: colors.muted,
                marginBottom: spacing.sm,
              }}
            >
              Motivo (obligatorio)
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {FAIL_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason.key}
                  onPress={() => setFailReason(reason.key)}
                  style={{
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor:
                      failReason === reason.key ? colors.danger : colors.border2,
                    backgroundColor:
                      failReason === reason.key ? colors.danger : colors.surface2,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: fonts.sansSemibold,
                      fontSize: 13,
                      color: failReason === reason.key ? colors.bg : colors.text,
                    }}
                  >
                    {reason.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              onPress={() => void takePhoto().then((uri) => uri && setFailPhotoUri(uri))}
              style={photoButtonStyle}
            >
              <Text
                style={{
                  fontFamily: fonts.sansSemibold,
                  fontSize: 14,
                  color: failPhotoUri ? colors.success : colors.active,
                }}
              >
                {failPhotoUri ? "✓ Foto tomada" : "📷 SACAR FOTO (obligatoria)"}
              </Text>
            </TouchableOpacity>

            <TextInput
              style={[inputStyle, { minHeight: 90, textAlignVertical: "top" }]}
              value={failComment}
              onChangeText={setFailComment}
              placeholder="Comentario (opcional)"
              placeholderTextColor={colors.muted2}
              multiline
            />

            <TouchableOpacity
              onPress={() => void submitFail()}
              disabled={failing}
              style={[
                primaryButtonStyle,
                { backgroundColor: colors.danger, opacity: failing ? 0.6 : 1 },
              ]}
            >
              <Text style={primaryButtonTextStyle}>
                {failing ? "GUARDANDO…" : "REPORTAR INCIDENCIA"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setFailOpen(false)}
              style={{ alignSelf: "center", padding: spacing.md }}
            >
              <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.muted }}>
                Cancelar
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const primaryButtonStyle = {
  height: touch.primaryButton,
  borderRadius: radius.md,
  backgroundColor: colors.success,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  marginTop: spacing.md,
};

const primaryButtonTextStyle = {
  fontFamily: fonts.sansBold,
  fontSize: 18,
  color: colors.bg,
  letterSpacing: 1,
};

const secondaryButtonStyle = {
  height: touch.primaryButton,
  borderRadius: radius.md,
  backgroundColor: colors.surface2,
  borderWidth: 1,
  borderColor: colors.danger,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  marginTop: spacing.md,
};

const navButtonStyle = {
  flex: 1,
  height: touch.minTarget,
  borderRadius: radius.md,
  backgroundColor: colors.surface2,
  borderWidth: 1,
  borderColor: colors.border2,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};

const photoButtonStyle = {
  marginTop: spacing.lg,
  height: touch.minTarget,
  borderRadius: radius.md,
  backgroundColor: colors.surface2,
  borderWidth: 1,
  borderColor: colors.border2,
  borderStyle: "dashed" as const,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};

const inputStyle = {
  minHeight: touch.minTarget,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: colors.border2,
  backgroundColor: colors.surface2,
  paddingHorizontal: spacing.md,
  color: colors.text,
  fontFamily: fonts.sans,
  fontSize: 16,
};

const sheetOverlayStyle = {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.6)",
  justifyContent: "flex-end" as const,
};

const sheetCardStyle = {
  backgroundColor: colors.surface,
  borderTopLeftRadius: 20,
  borderTopRightRadius: 20,
  padding: spacing.xl,
  paddingBottom: spacing.xxl,
  gap: spacing.xs,
};
