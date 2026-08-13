import * as React from "react";
import { Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { driverQrPayload } from "@fyc/shared";
import { useSession } from "../../src/context/session";
import { colors, fonts, radius, spacing } from "../../src/theme/tokens";

/**
 * "Mi identificación" — QR propio del chofer para el control de salida del
 * depósito (pedido explícito de Fede, no está en PROMPT-MAESTRO original:
 * depósito escanea este QR para registrar que el chofer salió con la ruta
 * cargada, ANTES/además del login de la app — ver `driver.ts#checkInDriver`
 * y ADR correspondiente). Se genera 100% local con `react-native-qrcode-svg`
 * — nada de pedirle la imagen al servidor, funciona sin conexión (§7: la
 * app es offline-first) y no expone ningún dato sensible: el payload es
 * solo el id de usuario, igual de "secreto" que el QR de un contenedor.
 */
export default function IdentificacionScreen() {
  const { session } = useSession();
  const userId = session?.user.id;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: "center",
        justifyContent: "center",
        padding: spacing.lg,
        gap: spacing.lg,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.sansBold,
          fontSize: 20,
          color: colors.text,
          textAlign: "center",
        }}
      >
        Mostrá este QR para salir del depósito
      </Text>
      <Text
        style={{
          fontFamily: fonts.sans,
          fontSize: 14,
          color: colors.muted,
          textAlign: "center",
        }}
      >
        Depósito lo escanea para confirmar que salís con la ruta cargada.
      </Text>

      <View
        style={{
          backgroundColor: "#ffffff",
          padding: spacing.lg,
          borderRadius: radius.lg,
        }}
      >
        {userId ? (
          <QRCode value={driverQrPayload(userId)} size={240} />
        ) : (
          <Text style={{ fontFamily: fonts.sans, color: colors.muted }}>
            Sin sesión — volvé a loguearte.
          </Text>
        )}
      </View>
    </View>
  );
}
