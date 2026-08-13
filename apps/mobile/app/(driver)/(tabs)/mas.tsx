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
import { useSession } from "../../../src/context/session";
import { downloadCurrentRoute } from "../../../src/lib/db/routes";
import { colors, fonts, radius, spacing, touch } from "../../../src/theme/tokens";

/**
 * "Más" — menú de acciones que no son de monitoreo diario de la ruta
 * (esas viven en el tab Ruta): identificación, custodia, escaneo manual,
 * re-descargar la ruta, cerrar sesión. Mismo criterio que separa "estado
 * operativo" de "acciones" en la app de referencia que mostró Fede.
 */
export default function MasScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { session, signOut } = useSession();
  const [downloading, setDownloading] = React.useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadCurrentRoute(db);
      router.push("/ruta");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
    >
      <View style={{ gap: spacing.xs }}>
        <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.muted }}>
          ¡Hola!
        </Text>
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 20, color: colors.text }}>
          {session?.user.email ?? "Chofer FYC"}
        </Text>
      </View>

      <MenuButton
        label="Mi identificación (QR de salida)"
        onPress={() => router.push("/identificacion")}
      />
      <MenuButton label="Custodia y carga" onPress={() => router.push("/custodia")} />
      <MenuButton label="Escanear paquetes" onPress={() => router.push("/escanear")} />

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
          marginTop: spacing.md,
        }}
      >
        <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.muted }}>
          Cerrar sesión
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function MenuButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        height: touch.primaryButton,
        borderRadius: radius.md,
        backgroundColor: colors.text,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}
