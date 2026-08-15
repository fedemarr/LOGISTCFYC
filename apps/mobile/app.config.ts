import type { ExpoConfig } from "expo/config";

/**
 * FASE 13 — Sentry mobile. El config plugin `@sentry/react-native/expo`
 * sólo se activa cuando SENTRY_ORG y SENTRY_PROJECT existen en el entorno
 * (como secrets de EAS Build); sin ellos el SDK sigue funcionando en
 * runtime (si EXPO_PUBLIC_SENTRY_DSN está seteado) pero no se suben source
 * maps. El DSN NO va acá — el plugin exige org/project porque la subida
 * la hace sentry-cli con SENTRY_AUTH_TOKEN del entorno de build.
 */
const sentryPlugin: [string, Record<string, string>] | null =
  process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? [
        "@sentry/react-native/expo",
        {
          url: "https://sentry.io/",
          project: process.env.SENTRY_PROJECT,
          organization: process.env.SENTRY_ORG,
        },
      ]
    : null;

/**
 * PROMPT-MAESTRO §5: "Development Build, NO Expo Go [...] Configurar EAS
 * Build desde la FASE 1 — descubrirlo en la FASE 10 obliga a rehacer."
 *
 * ⚠️ `slug`, `android.package` e `ios.bundleIdentifier` son PLACEHOLDERS
 * (`com.fyc.mobile`). El package name de Android es inmutable una vez
 * publicado en Play — confirmar el nombre real antes del primer build de
 * EAS. Ver docs/DECISIONES.md.
 */
const config: ExpoConfig = {
  name: "FYC",
  // Tiene que matchear el slug del proyecto ya creado en expo.dev
  // (identificado por `extra.eas.projectId` acá abajo) — si no matchean,
  // `eas build` falla antes de arrancar. Ver docs/DECISIONES.md FASE 7-8.
  slug: "fyc-logistica",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "fyc",
  userInterfaceStyle: "automatic", // dark mode obligatorio en la app del chofer (§13)
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.fyc.mobile",
  },
  android: {
    package: "com.fyc.mobile",
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-dev-client",
    "expo-router",
    "expo-sqlite",
    "expo-secure-store",
    "expo-font",
    "expo-splash-screen",
    "expo-audio",
    [
      "expo-notifications",
      {
        color: "#0B6BCB",
        defaultChannel: "default",
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission:
          "FYC usa la cámara para escanear códigos y fotografiar etiquetas de los paquetes.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "FYC usa tu ubicación para guiarte en las rutas y registrar las entregas.",
        isAndroidBackgroundLocationEnabled: true,
        isIosBackgroundLocationEnabled: true,
      },
    ],
    [
      "expo-image-picker",
      {
        cameraPermission:
          "FYC usa la cámara para fotografiar la evidencia de las entregas (§9.6).",
        photosPermission: "FYC accede a tus fotos para adjuntar evidencia.",
        microphonePermission: false,
      },
    ],
    ...(sentryPlugin ? [sentryPlugin] : []),
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: "e01f2812-ca91-449c-b064-1e1d0f6eabe0",
    },
  },
};

export default config;
