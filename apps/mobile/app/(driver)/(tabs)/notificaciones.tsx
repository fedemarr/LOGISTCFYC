import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { colors, fonts, spacing } from "../../../src/theme/tokens";

/**
 * "Notificaciones" — placeholder a propósito. No hay backend de
 * notificaciones push todavía (no está en ninguna fase cerrada del
 * documento madre) — mostrar datos inventados acá sería mentirle al
 * chofer sobre el estado real del sistema. Cuando exista el backend real
 * (avisos de nuevas paradas, cambios de ruta, mensajes del dispatcher),
 * esta pantalla se conecta — la estructura de tabs ya queda lista.
 */
export default function NotificacionesScreen() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: "center",
        justifyContent: "center",
        padding: spacing.lg,
        gap: spacing.md,
      }}
    >
      <Ionicons name="notifications-outline" size={40} color={colors.muted} />
      <Text
        style={{
          fontFamily: fonts.sans,
          fontSize: 15,
          color: colors.muted,
          textAlign: "center",
        }}
      >
        Todavía no hay notificaciones.
      </Text>
    </View>
  );
}
