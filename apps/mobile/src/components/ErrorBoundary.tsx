import * as React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import * as Sentry from "@sentry/react-native";
import { colors, fonts, radius, spacing, touch } from "../theme/tokens";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Red de seguridad contra crashes de JS (pedido de Fede: "la app se
 * crasheó toda y tuve que reiniciar"). Sin esto, cualquier error no
 * atrapado en el árbol de React tumba la app entera sin aviso — con
 * esto, se ve una pantalla de "algo salió mal" con botón para
 * reintentar (remonta los hijos) en vez de un crash duro.
 *
 * No es magia: solo atrapa errores de RENDER de React (la causa más
 * común de "pantalla blanca/crash" en apps RN). Un crash nativo de
 * verdad (memoria, un módulo nativo roto) sigue tumbando el proceso —
 * para eso hace falta Sentry con el DSN real cargado (`EXPO_PUBLIC_
 * SENTRY_DSN`, hoy vacío en el build — ver `docs/DECISIONES.md`), que
 * es la única forma de ver un stack trace real de un crash reportado
 * sin poder reproducirlo acá.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  override render(): React.ReactNode {
    if (this.state.error) {
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
              fontFamily: fonts.sansBold,
              fontSize: 20,
              color: colors.text,
              textAlign: "center",
            }}
          >
            Algo salió mal
          </Text>
          <Text
            style={{
              fontFamily: fonts.sans,
              fontSize: 14,
              color: colors.muted,
              textAlign: "center",
            }}
          >
            La pantalla tuvo un error inesperado. Podés reintentar — si sigue pasando,
            avisale a soporte.
          </Text>
          <TouchableOpacity
            onPress={() => this.setState({ error: null })}
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
              Reintentar
            </Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}
