import * as React from "react";
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useSession } from "../src/context/session";
import { colors, fonts, radius, spacing, touch } from "../src/theme/tokens";

/**
 * Login del chofer/depósito — mismas credenciales que el panel web
 * (Supabase Auth, un solo directorio de usuarios para todo el sistema).
 * Sin onboarding forzado adelante: si ya vio la introducción, entra
 * directo (`onboarding` es la ruta siguiente solo la primera vez, ver
 * `app/onboarding.tsx`).
 */
export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useSession();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    const result = await signIn(email.trim(), password);
    setSubmitting(false);
    if (result.error) {
      setError("Email o contraseña incorrectos.");
      return;
    }
    // Stack.Protected en app/_layout.tsx redirige solo a (driver) al detectar sesión.
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        justifyContent: "center",
        padding: spacing.xl,
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.lg,
          backgroundColor: colors.text,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: spacing.lg,
        }}
      >
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 24, color: colors.bg }}>
          F
        </Text>
      </View>

      <Text
        style={{
          fontFamily: fonts.sansBold,
          fontSize: 28,
          color: colors.text,
          marginBottom: spacing.xs,
        }}
      >
        FYC
      </Text>
      <Text
        style={{
          fontFamily: fonts.sans,
          fontSize: touch.baseFontSize,
          color: colors.muted,
          marginBottom: spacing.xxl,
        }}
      >
        Ingresá con tu usuario de trabajo.
      </Text>

      <Text style={styles.label}>Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="chofer@fyc.demo"
        placeholderTextColor={colors.muted2}
        style={styles.input}
      />

      <Text style={[styles.label, { marginTop: spacing.md }]}>Contraseña</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        placeholderTextColor={colors.muted2}
        style={styles.input}
      />

      {error && (
        <Text
          style={{
            fontFamily: fonts.sans,
            color: colors.danger,
            marginTop: spacing.md,
            fontSize: 15,
          }}
        >
          {error}
        </Text>
      )}

      <TouchableOpacity
        onPress={() => void handleSubmit()}
        disabled={submitting || !email || !password}
        style={[
          styles.button,
          { opacity: submitting || !email || !password ? 0.5 : 1, marginTop: spacing.xl },
        ]}
      >
        {submitting ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}>
            Entrar
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => router.push("/onboarding")}
        style={{
          marginTop: spacing.lg,
          alignSelf: "center",
          minHeight: touch.minTarget,
          justifyContent: "center",
        }}
      >
        <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.muted }}>
          ¿Cómo funciona la app?
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = {
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: "uppercase" as const,
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  input: {
    fontFamily: fonts.sans,
    fontSize: touch.baseFontSize,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: touch.minTarget,
  },
  button: {
    height: touch.primaryButton,
    borderRadius: radius.md,
    backgroundColor: colors.text,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
};
