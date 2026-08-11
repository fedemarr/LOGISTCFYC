import type { ExpoConfig } from "expo/config";

/**
 * PROMPT-MAESTRO §5: "Development Build, NO Expo Go [...] Configurar EAS
 * Build desde la FASE 1 — descubrirlo en la FASE 10 obliga a rehacer."
 *
 * ⚠️ `slug`, `android.package` e `ios.bundleIdentifier` son PLACEHOLDERS
 * (`com.lastmile.mobile`). El package name de Android es inmutable una vez
 * publicado en Play — confirmar el nombre real antes del primer build de
 * EAS. Ver docs/DECISIONES.md.
 */
const config: ExpoConfig = {
  name: "Lastmile",
  slug: "lastmile-mobile",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "lastmile",
  userInterfaceStyle: "automatic", // dark mode obligatorio en la app del chofer (§13)
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.lastmile.mobile",
  },
  android: {
    package: "com.lastmile.mobile",
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
  plugins: ["expo-dev-client"],
  extra: {
    eas: {
      // Se completa con `eas init` cuando haya una cuenta Expo vinculada.
      projectId: undefined,
    },
  },
};

export default config;
