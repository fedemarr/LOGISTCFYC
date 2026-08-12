import * as React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, fonts, radius, spacing, touch } from "../src/theme/tokens";

/**
 * Onboarding (§13): "5 pantallas, salteable, re-accesible desde Ayuda".
 * La re-accesibilidad desde Ayuda queda para cuando exista esa pantalla
 * (módulo de soporte, FASE 12) — hoy se llega acá desde el login
 * ("¿Cómo funciona la app?") o la primera vez que se abre la app.
 */
const SLIDES = [
  {
    title: "Bienvenido a FYC",
    body: "Esta app te acompaña durante el reparto: tu ruta, tus paradas, y cómo registrar cada entrega.",
  },
  {
    title: "Tomar la carga",
    body: "Al empezar, escaneá el QR del contenedor de tu ruta y contá los bultos. Si no coincide, la app te dice exactamente cuál falta o sobra.",
  },
  {
    title: "Entregar en 3 toques",
    body: "ENTREGAR → nombre de quien recibe → foto → CONFIRMAR. La ubicación, la hora y la distancia se registran solas.",
  },
  {
    title: "Si hay un problema",
    body: "Tocá PROBLEMA, elegí el motivo y sacá una foto. Podés seguir con la parada siguiente — Operaciones lo resuelve del otro lado.",
  },
  {
    title: "Permisos que te vamos a pedir",
    body: "Ubicación (para que Operaciones sepa dónde estás en ruta y vos llegues bien), cámara (evidencia de entrega) y batería (para que el tracking no se corte). Solo se usan mientras tenés una ruta activa.",
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const [index, setIndex] = React.useState(0);
  const isLast = index === SLIDES.length - 1;
  const slide = SLIDES[index]!;

  function next() {
    if (isLast) {
      router.back();
      return;
    }
    setIndex((i) => i + 1);
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        padding: spacing.xl,
        justifyContent: "space-between",
      }}
    >
      <TouchableOpacity
        onPress={() => router.back()}
        style={{
          alignSelf: "flex-end",
          minHeight: touch.minTarget,
          justifyContent: "center",
        }}
      >
        <Text style={{ fontFamily: fonts.sansMedium, color: colors.muted, fontSize: 15 }}>
          Saltear
        </Text>
      </TouchableOpacity>

      <View>
        <Text
          style={{
            fontFamily: fonts.mono,
            color: colors.muted2,
            fontSize: 13,
            marginBottom: spacing.md,
          }}
        >
          {index + 1} / {SLIDES.length}
        </Text>
        <Text
          style={{
            fontFamily: fonts.sansBold,
            fontSize: 26,
            color: colors.text,
            marginBottom: spacing.md,
          }}
        >
          {slide.title}
        </Text>
        <Text
          style={{
            fontFamily: fonts.sans,
            fontSize: touch.baseFontSize,
            color: colors.muted,
            lineHeight: 26,
          }}
        >
          {slide.body}
        </Text>
      </View>

      <View>
        <View
          style={{
            flexDirection: "row",
            gap: spacing.xs,
            marginBottom: spacing.lg,
            justifyContent: "center",
          }}
        >
          {SLIDES.map((s, i) => (
            <View
              key={s.title}
              style={{
                width: i === index ? 20 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === index ? colors.text : colors.border2,
              }}
            />
          ))}
        </View>
        <TouchableOpacity
          onPress={next}
          style={{
            height: touch.primaryButton,
            borderRadius: radius.md,
            backgroundColor: colors.text,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.bg }}>
            {isLast ? "Listo" : "Siguiente"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
