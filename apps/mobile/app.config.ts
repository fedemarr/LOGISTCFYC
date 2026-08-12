import type { ExpoConfig } from "expo/config";

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
      "expo-camera",
      {
        cameraPermission:
          "FYC usa la cámara para escanear códigos y fotografiar etiquetas de los paquetes.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
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
